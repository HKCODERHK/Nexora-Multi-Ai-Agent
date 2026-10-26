// Keyword search pieces: a tokenizer, BM25 sparse vectors for Qdrant, and
// Reciprocal Rank Fusion to merge keyword and vector rankings.

const STOPWORDS = new Set(("a an and are as at be but by can do does for from has have how i if in into is it its " +
    "of on or so than that the their them then there these they this to was we were what when where which " +
    "who why will with you your").split(" "))

export const tokenize = (text) =>
    String(text ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t && !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)))

// FNV-1a: a stable 32-bit id for each term, used as the sparse-vector index.
export const termId = (term) => {
    let hash = 0x811c9dc5
    for (let i = 0; i < term.length; i++) {
        hash ^= term.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

const counts = (tokens) => {
    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    return tf
}

export const BM25_K1 = 1.2
export const BM25_B = 0.75

// Document side of BM25: term-frequency with saturation and length normalisation.
// Qdrant multiplies it by the IDF (sparse vector "modifier: idf") at query time,
// so score(query, chunk) = Σ idf(t) · tf(t)·(k1+1) / (tf(t) + k1·(1 − b + b·len/avgLen)).
export const toSparseVector = (text, { avgLength } = {}) => {
    const tokens = tokenize(text)
    const length = tokens.length || 1
    const avg = avgLength || length
    const norm = BM25_K1 * (1 - BM25_B + BM25_B * (length / avg))
    const entries = [...counts(tokens)].map(([term, tf]) => [termId(term), (tf * (BM25_K1 + 1)) / (tf + norm)])
    return sparseFromEntries(entries)
}

// Query side: every distinct query term counts once.
export const toSparseQuery = (text) => sparseFromEntries([...counts(tokenize(text)).keys()].map((t) => [termId(t), 1]))

const sparseFromEntries = (entries) => {
    // merge hash collisions so indices stay unique
    const merged = new Map()
    for (const [index, value] of entries) merged.set(index, (merged.get(index) || 0) + value)
    const sorted = [...merged].sort((a, b) => a[0] - b[0])
    return { indices: sorted.map(([i]) => i), values: sorted.map(([, v]) => v) }
}

export const averageLength = (texts) => {
    if (!texts.length) return 1
    return texts.reduce((sum, t) => sum + tokenize(t).length, 0) / texts.length || 1
}

// Reciprocal Rank Fusion: score(d) = Σ over lists 1 / (k + rank), rank starting at 1.
// It only uses positions, so cosine scores and BM25 scores never need to be on the same scale.
export const reciprocalRankFusion = (lists, { k = 60, key = (item) => item.id } = {}) => {
    const fused = new Map()
    for (const list of lists) {
        list.forEach((item, index) => {
            const id = key(item)
            const entry = fused.get(id) || { item, score: 0 }
            entry.score += 1 / (k + index + 1)
            fused.set(id, entry)
        })
    }
    return [...fused.values()]
        .sort((a, b) => b.score - a.score)
        .map(({ item, score }) => ({ ...item, score }))
}
