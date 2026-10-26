import crypto from "node:crypto"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { getEmbeddings, getQdrant } from "./clients.js"
import { averageLength, toSparseVector } from "./bm25.js"

export const EMBEDDING_MODEL = "gemini-embedding-001"
// bump when the stored layout changes, so old collections are not reused
const SCHEMA_VERSION = "v2"

export const DEFAULT_CHUNKING = { chunkSize: 1000, chunkOverlap: 200 }

export const COLLECTION_PREFIX = "pdf-"

export const DENSE_VECTOR = "dense"
export const SPARSE_VECTOR = "bm25"

export const splitText = async (text, { chunkSize, chunkOverlap } = DEFAULT_CHUNKING) => {
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap })
    return splitter.splitText(text)
}

// Same PDF text + same chunk settings → same collection, so it is embedded once.
export const collectionNameFor = (text, { chunkSize, chunkOverlap } = DEFAULT_CHUNKING) => {
    const hash = crypto
        .createHash("sha256")
        .update(`${SCHEMA_VERSION}|${EMBEDDING_MODEL}|${chunkSize}|${chunkOverlap}|${text}`)
        .digest("hex")
    return `${COLLECTION_PREFIX}${hash.slice(0, 32)}`
}

const isAlreadyExists = (error) => error?.status === 409 || /already exists/i.test(error?.message ?? "")

// Chunk the text, embed it and store it in Qdrant (dense + BM25 sparse vectors).
// Re-uses the collection when the same text was already indexed completely.
export const indexDocument = async (text, { chunkSize, chunkOverlap, source = "document" } = DEFAULT_CHUNKING) => {
    const settings = {
        chunkSize: chunkSize ?? DEFAULT_CHUNKING.chunkSize,
        chunkOverlap: chunkOverlap ?? DEFAULT_CHUNKING.chunkOverlap
    }
    const chunks = await splitText(text, settings)
    if (!chunks.length) {
        throw new Error("The document has no text to index.")
    }

    const qdrant = getQdrant()
    const collectionName = collectionNameFor(text, settings)
    const now = Date.now()

    const { exists } = await qdrant.collectionExists(collectionName)
    if (exists) {
        const { count } = await qdrant.count(collectionName, { exact: true })
        if (count === chunks.length) {
            // remember the last use, so the cleanup script keeps collections that are still read
            await qdrant.setPayload(collectionName, { payload: { lastUsedAt: now }, points: [0], wait: false })
            return { collectionName, chunkCount: chunks.length, reused: true }
        }
        // a half-written collection (e.g. a crash during upload): rebuild it
        await qdrant.deleteCollection(collectionName)
    }

    const embeddings = await getEmbeddings()
    const vectors = await embeddings.embedDocuments(chunks)
    const avgLength = averageLength(chunks)

    try {
        await qdrant.createCollection(collectionName, {
            vectors: { [DENSE_VECTOR]: { size: vectors[0].length, distance: "Cosine" } },
            sparse_vectors: { [SPARSE_VECTOR]: { modifier: "idf" } }
        })
    } catch (error) {
        // another request indexing the same PDF got there first; ids are deterministic, so upserting is safe
        if (!isAlreadyExists(error)) throw error
    }

    await qdrant.upsert(collectionName, {
        wait: true,
        points: chunks.map((chunk, i) => ({
            id: i,
            vector: {
                [DENSE_VECTOR]: vectors[i],
                [SPARSE_VECTOR]: toSparseVector(chunk, { avgLength })
            },
            payload: { text: chunk, chunkIndex: i, source, createdAt: now, lastUsedAt: now, ...settings }
        }))
    })

    return { collectionName, chunkCount: chunks.length, reused: false }
}
