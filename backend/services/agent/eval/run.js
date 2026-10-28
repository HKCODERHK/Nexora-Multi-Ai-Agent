// RAG evaluation: npm run eval -- [--chunk 1000] [--overlap 200] [--mode dense|hybrid] [--k 5] [--judge] [--label name]
//
// For each question: index its document (cached collection), retrieve top k, answer with the
// production prompt and model, then score hit@k, MRR and answer correctness (key facts present).
// Writes eval/results/<date>-<config>.json and appends a row to eval/RESULTS.md.
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { indexDocument, DEFAULT_CHUNKING } from "../rag/indexDocument.js"
import { retrieve, DEFAULT_RETRIEVAL } from "../rag/retrieve.js"
import { answerFromContext } from "../rag/answer.js"
import { answerCorrect, firstHitRank, missingFacts, summarise } from "./metrics.js"
import { createJudge, EVAL_DIR, loadDocs, setupEval } from "./setup.js"

const { values: args } = parseArgs({
    options: {
        chunk: { type: "string", default: String(DEFAULT_CHUNKING.chunkSize) },
        overlap: { type: "string", default: String(DEFAULT_CHUNKING.chunkOverlap) },
        mode: { type: "string", default: DEFAULT_RETRIEVAL.mode },
        k: { type: "string", default: String(DEFAULT_RETRIEVAL.k) },
        label: { type: "string", default: "" },
        judge: { type: "boolean", default: false },
        "no-answer-cache": { type: "boolean", default: false },
        only: { type: "string", default: "" }
    }
})

const chunking = { chunkSize: Number(args.chunk), chunkOverlap: Number(args.overlap) }
const k = Number(args.k)
const mode = args.mode
const config = `c${chunking.chunkSize}-o${chunking.chunkOverlap}-${mode}-k${k}`

const pct = (x) => `${(x * 100).toFixed(1)}%`

const main = async () => {
    const started = Date.now()
    const { stats, answerModel, qdrantUrl } = await setupEval({ answerCache: !args["no-answer-cache"] })
    const judge = args.judge ? await createJudge({ stats }) : null

    const docs = loadDocs()
    let questions = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, "questions.json"), "utf8"))
    if (args.only) questions = questions.filter((q) => args.only.split(",").includes(q.id))

    console.log(`Nexora RAG eval · ${config} · answer model ${answerModel} · Qdrant ${qdrantUrl}`)

    const collections = {}
    for (const doc of new Set(questions.map((q) => q.doc))) {
        if (!docs[doc]) throw new Error(`questions.json refers to missing document eval/docs/${doc}`)
        const indexed = await indexDocument(docs[doc], { ...chunking, source: doc })
        collections[doc] = indexed.collectionName
        console.log(`  indexed ${doc}: ${indexed.chunkCount} chunks${indexed.reused ? " (reused)" : ""}`)
    }

    const rows = []
    for (const q of questions) {
        const chunks = await retrieve(q.question, { collectionName: collections[q.doc], k, mode })
        const rank = firstHitRank(chunks, q.must_retrieve)
        const answer = await answerFromContext(q.question, chunks)
        const row = {
            id: q.id,
            doc: q.doc,
            type: q.type,
            review: Boolean(q.review),
            question: q.question,
            hit: rank !== null,
            rank,
            reciprocalRank: rank ? 1 / rank : 0,
            correct: answerCorrect(answer, q.key_facts),
            missingFacts: missingFacts(answer, q.key_facts),
            answer,
            retrieved: chunks.map((c) => ({ rank: c.rank, score: c.score, chunkIndex: c.chunkIndex, preview: c.text.slice(0, 160) }))
        }
        if (judge) row.judge = await judge.grade({ question: q.question, keyFacts: q.key_facts, answer })
        rows.push(row)
        console.log(`  ${q.id} hit=${row.hit ? "Y" : "n"} rank=${rank ?? "-"} correct=${row.correct ? "Y" : "n"}${judge ? ` judge=${row.judge ? "Y" : "n"}` : ""}`)
    }

    const summary = summarise(rows)
    const seconds = (Date.now() - started) / 1000
    const date = new Date().toISOString().slice(0, 10)
    const name = `${date}-${config}${args.label ? `-${args.label}` : ""}`

    const resultsDir = path.join(EVAL_DIR, "results")
    fs.mkdirSync(resultsDir, { recursive: true })
    fs.writeFileSync(
        path.join(resultsDir, `${name}.json`),
        JSON.stringify({ name, date, config: { ...chunking, mode, k }, answerModel, judgeModel: judge?.model ?? null, summary, seconds, cache: stats, rows }, null, 2)
    )

    const resultsMd = path.join(EVAL_DIR, "RESULTS.md")
    if (!fs.existsSync(resultsMd)) {
        fs.writeFileSync(
            resultsMd,
            "# RAG evaluation results\n\n" +
                "30 questions over 3 documents (`eval/questions.json`). hit@5 and MRR measure retrieval; correctness = every key fact appears in the answer (deterministic, the main number). " +
                "The LLM judge column is an optional second opinion. Time includes cached calls (embeddings/answers are cached on disk).\n\n" +
                "| Date | Config | Label | hit@5 | MRR | Correctness | LLM judge (2nd opinion) | Time |\n|---|---|---|---|---|---|---|---|\n"
        )
    }
    fs.appendFileSync(
        resultsMd,
        `| ${date} | ${config} | ${args.label || "-"} | ${pct(summary.hitAt5)} | ${summary.mrr.toFixed(3)} | ${pct(summary.correctness)} | ${summary.judge === null ? "-" : pct(summary.judge)} | ${seconds.toFixed(0)}s |\n`
    )

    console.log(`\n${config}: hit@${k} ${pct(summary.hitAt5)} · MRR ${summary.mrr.toFixed(3)} · correctness ${pct(summary.correctness)}${summary.judge === null ? "" : ` · judge ${pct(summary.judge)}`} · ${seconds.toFixed(0)}s`)
    console.log(`cache: embeddings ${stats.embeddingHits} hit / ${stats.embeddingMisses} new · LLM ${stats.llmHits} hit / ${stats.llmMisses} new`)
    console.log(`saved eval/results/${name}.json`)
}

main().catch((error) => {
    console.error(error.message ?? error)
    process.exit(1)
})
