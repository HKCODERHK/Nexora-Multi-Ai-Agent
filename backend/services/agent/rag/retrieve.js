import { getEmbeddings, getQdrant } from "./clients.js"
import { reciprocalRankFusion, toSparseQuery } from "./bm25.js"
import { DENSE_VECTOR, SPARSE_VECTOR } from "./indexDocument.js"

export const RETRIEVAL_MODES = ["dense", "hybrid"]
export const DEFAULT_RETRIEVAL = { k: 5, mode: "dense" }
export const RRF_K = 60

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

const searchKeywords = async (qdrant, collectionName, query, limit) => {
    const sparse = toSparseQuery(query)
    if (!sparse.indices.length) return []
    const { points } = await qdrant.query(collectionName, {
        query: sparse,
        using: SPARSE_VECTOR,
        limit,
        with_payload: true
    })
    return points.map(toChunk)
}

// Top-k chunks for a query.
// dense:  vector similarity only (what Nexora always did).
// hybrid: vector list + BM25 keyword list, merged with Reciprocal Rank Fusion (k = 60).
export const retrieve = async (query, { collectionName, k = DEFAULT_RETRIEVAL.k, mode = DEFAULT_RETRIEVAL.mode, candidates } = {}) => {
    if (!collectionName) throw new Error("retrieve() needs a collectionName from indexDocument().")
    if (!RETRIEVAL_MODES.includes(mode)) throw new Error(`Unknown retrieval mode "${mode}".`)

    const qdrant = getQdrant()

    if (mode === "dense") {
        return (await searchDense(qdrant, collectionName, query, k)).map((c, i) => ({ ...c, rank: i + 1 }))
    }

    // look deeper than k in each list, so a chunk ranked 7th by one and 2nd by the other can still win
    const depth = candidates ?? Math.max(k * 4, 20)
    const [dense, keyword] = await Promise.all([
        searchDense(qdrant, collectionName, query, depth),
        searchKeywords(qdrant, collectionName, query, depth)
    ])
    return reciprocalRankFusion([dense, keyword], { k: RRF_K })
        .slice(0, k)
        .map((c, i) => ({ ...c, rank: i + 1 }))
}
