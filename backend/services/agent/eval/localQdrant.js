import { QdrantClient } from "@qdrant/js-client-rest"

export const DEFAULT_LOCAL_QDRANT = "http://localhost:6333"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

// The evaluation must never write to the production Qdrant.
export const assertLocalQdrantUrl = (url) => {
    let host
    try {
        host = new URL(url).hostname
    } catch {
        throw new Error(`EVAL_QDRANT_URL is not a valid URL: ${url}`)
    }
    if (!LOCAL_HOSTS.has(host)) {
        throw new Error(`Refusing to run the evaluation against ${host}: only a local Qdrant (localhost:6333) is allowed.`)
    }
    return url
}

export const createLocalQdrant = (url = process.env.EVAL_QDRANT_URL || DEFAULT_LOCAL_QDRANT) =>
    // no apiKey on purpose: a local Qdrant needs none, and the production key must never leave .env
    new QdrantClient({ url: assertLocalQdrantUrl(url), checkCompatibility: false })

export const checkQdrantIsUp = async (qdrant, url) => {
    try {
        await qdrant.getCollections()
    } catch (error) {
        throw new Error(`Cannot reach the local Qdrant at ${url}. Start it with:\n  docker run -p 6333:6333 qdrant/qdrant\n(${error.message})`)
    }
}
