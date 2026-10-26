import { getEmbeddings, getQdrant } from "./clients.js"
import { DENSE_VECTOR } from "./indexDocument.js"

export const RETRIEVAL_MODES = ["dense"]
export const DEFAULT_RETRIEVAL = { k: 5, mode: "dense" }

const toChunk = (point) => ({
    id: point.id,
    text: point.payload?.text ?? "",
    score: point.score,
    chunkIndex: point.payload?.chunkIndex,
    source: point.payload?.source
})

const searchDense = async (qdrant, collectionName, query, limit) => {
    const embeddings = await getEmbeddings()
    const vector = await embeddings.embedQuery(query)
    const { points } = await qdrant.query(collectionName, {
        query: vector,
        using: DENSE_VECTOR,
        limit,
        with_payload: true
    })
    return points.map(toChunk)
}

// Top-k chunks for a query.
// dense: vector similarity only (what Nexora always did).
export const retrieve = async (query, { collectionName, k = DEFAULT_RETRIEVAL.k, mode = DEFAULT_RETRIEVAL.mode } = {}) => {
    if (!collectionName) throw new Error("retrieve() needs a collectionName from indexDocument().")
    if (!RETRIEVAL_MODES.includes(mode)) throw new Error(`Unknown retrieval mode "${mode}".`)

    const qdrant = getQdrant()

    return (await searchDense(qdrant, collectionName, query, k)).map((c, i) => ({ ...c, rank: i + 1 }))
}
