import { QdrantClient } from "@qdrant/js-client-rest"

// Where the RAG pieces get their Qdrant client, embeddings and answer LLM.
// Production uses QDRANT_URL / QDRANT_API_KEY and the shared model config.
// The evaluation, the MCP server and the tests swap them with configureRag().

let overrides = {}
let defaultQdrant

export const configureRag = (options = {}) => {
    overrides = { ...overrides, ...options }
}

export const resetRag = () => {
    overrides = {}
}

export const getQdrant = () => {
    if (overrides.qdrant) return overrides.qdrant
    defaultQdrant ??= new QdrantClient({
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY,
        checkCompatibility: false
    })
    return defaultQdrant
}

// Lazy imports: the provider SDKs are only constructed when actually used.
export const getEmbeddings = async () => {
    if (overrides.embeddings) return overrides.embeddings
    return (await import("../config/embeddings.js")).embeddings
}

export const getAnswerModel = async () => {
    if (overrides.llm) return overrides.llm
    return (await import("../config/llmModels.js")).getModel("pdf-rag")
}
