// In-memory stand-in for @qdrant/js-client-rest, covering what rag/ uses.
// Dense search = cosine similarity; sparse search = dot product with Qdrant's IDF modifier.

const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const sparseMap = ({ indices, values }) => new Map(indices.map((i, n) => [i, values[n]]))

export const createFakeQdrant = () => {
    const collections = new Map()
    const calls = []

    const get = (name) => {
        const c = collections.get(name)
        if (!c) throw Object.assign(new Error(`Collection ${name} not found`), { status: 404 })
        return c
    }

    return {
        collections,
        calls,
        async collectionExists(name) {
            calls.push(["collectionExists", name])
            return { exists: collections.has(name) }
        },
        async getCollections() {
            return { collections: [...collections.keys()].map((name) => ({ name })) }
        },
        async createCollection(name, config) {
            calls.push(["createCollection", name])
            if (collections.has(name)) throw Object.assign(new Error(`Collection ${name} already exists`), { status: 409 })
            collections.set(name, { config, points: new Map() })
            return true
        },
        async deleteCollection(name) {
            calls.push(["deleteCollection", name])
            return collections.delete(name)
        },
        async count(name) {
            return { count: get(name).points.size }
        },
        async upsert(name, { points }) {
            calls.push(["upsert", name, points.length])
            const c = get(name)
            for (const p of points) c.points.set(p.id, structuredClone(p))
            return { status: "completed" }
        },
        async setPayload(name, { payload, points }) {
            const c = get(name)
            for (const id of points) {
                const p = c.points.get(id)
                if (p) p.payload = { ...p.payload, ...payload }
            }
            return { status: "completed" }
        },
        async scroll(name, { limit = 10 } = {}) {
            const pts = [...get(name).points.values()].slice(0, limit)
            return { points: pts.map((p) => ({ id: p.id, payload: p.payload })) }
        },
        async query(name, { query, using, limit = 10 }) {
            calls.push(["query", name, using])
            const c = get(name)
            const points = [...c.points.values()]
            let scored
            if (Array.isArray(query)) {
                scored = points.map((p) => ({ p, score: cosine(query, p.vector[using]) }))
            } else {
                const N = points.length
                const docs = points.map((p) => sparseMap(p.vector[using]))
                const idf = (term) => {
                    const n = docs.filter((d) => d.has(term)).length
                    return Math.log((N - n + 0.5) / (n + 0.5) + 1)
                }
                scored = points.map((p, i) => {
                    let score = 0
                    query.indices.forEach((term, n) => {
                        const v = docs[i].get(term)
                        if (v) score += idf(term) * v * query.values[n]
                    })
                    return { p, score }
                })
                // Qdrant only returns sparse matches with a non-zero score
                scored = scored.filter((s) => s.score > 0)
            }
            scored.sort((a, b) => b.score - a.score)
            return {
                points: scored.slice(0, limit).map(({ p, score }) => ({ id: p.id, score, payload: p.payload }))
            }
        }
    }
}

// Deterministic embeddings: hashed bag-of-words, so texts sharing words are "similar".
export const createFakeEmbeddings = (dims = 64) => {
    const embed = (text) => {
        const v = new Array(dims).fill(0)
        for (const word of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
            let h = 0
            for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) >>> 0
            v[h % dims] += 1
        }
        return v
    }
    const fake = {
        documentCalls: 0,
        queryCalls: 0,
        async embedDocuments(texts) {
            fake.documentCalls++
            return texts.map(embed)
        },
        async embedQuery(text) {
            fake.queryCalls++
            return embed(text)
        }
    }
    return fake
}
