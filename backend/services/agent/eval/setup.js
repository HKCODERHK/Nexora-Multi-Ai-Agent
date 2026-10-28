import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { configureRag } from "../rag/clients.js"
import { EMBEDDING_MODEL } from "../rag/indexDocument.js"
import { cachedEmbeddings, cachedLLM, createStats } from "./cache.js"
import { checkQdrantIsUp, createLocalQdrant, DEFAULT_LOCAL_QDRANT } from "./localQdrant.js"

export const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url))
export const CACHE_DIR = path.join(EVAL_DIR, ".cache")
export const DOCS_DIR = path.join(EVAL_DIR, "docs")

export const loadDocs = () =>
    Object.fromEntries(
        fs.readdirSync(DOCS_DIR)
            .filter((f) => f.endsWith(".md"))
            .map((f) => [f, fs.readFileSync(path.join(DOCS_DIR, f), "utf8")])
    )

// Wire the RAG code to: a LOCAL Qdrant, disk-cached Gemini embeddings and a disk-cached answer LLM.
// Keys come only from services/agent/.env on this machine.
export const setupEval = async ({ answerCache = true } = {}) => {
    dotenv.config({ path: path.join(EVAL_DIR, "..", ".env"), quiet: true })
    // the production Qdrant must be unreachable from here, whatever .env contains
    delete process.env.QDRANT_URL
    delete process.env.QDRANT_API_KEY

    if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY is missing from services/agent/.env (needed for embeddings).")

    const qdrantUrl = process.env.EVAL_QDRANT_URL || DEFAULT_LOCAL_QDRANT
    const qdrant = createLocalQdrant(qdrantUrl)
    await checkQdrantIsUp(qdrant, qdrantUrl)

    const stats = createStats()
    const { embeddings } = await import("../config/embeddings.js")
    const { getModel } = await import("../config/llmModels.js")
    const baseLlm = await getModel("pdf-rag")
    const answerModel = baseLlm.model ?? "pdf-rag-model"

    const llm = cachedLLM(baseLlm, { dir: CACHE_DIR, model: answerModel, stats, enabled: answerCache })
    configureRag({
        qdrant,
        embeddings: cachedEmbeddings(embeddings, { dir: CACHE_DIR, model: EMBEDDING_MODEL, stats }),
        llm
    })

    return { qdrant, qdrantUrl, stats, answerModel, llm }
}

// Optional second opinion: a different model grades the answer against the key facts.
export const createJudge = async ({ stats }) => {
    const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai")
    const model = "gemini-2.5-flash"
    const llm = cachedLLM(new ChatGoogleGenerativeAI({ model, temperature: 0 }), { dir: CACHE_DIR, model: `judge|${model}`, stats })
    return {
        model,
        async grade({ question, keyFacts, answer }) {
            const facts = keyFacts.map((f) => (Array.isArray(f) ? f.join(" OR ") : f)).join("; ")
            const response = await llm.invoke(
                `You grade answers. Question: ${question}\nExpected facts: ${facts}\nAnswer: ${answer}\n\n` +
                    "Does the answer correctly state every expected fact (wording may differ)? Reply with exactly PASS or FAIL."
            )
            return /\bPASS\b/i.test(response.content) && !/\bFAIL\b/i.test(response.content)
        }
    }
}
