import { beforeEach, describe, expect, it } from "vitest"
import { createFakeEmbeddings, createFakeQdrant } from "../../../test-utils/fakeQdrant.js"
import { configureRag, resetRag } from "./clients.js"
import { collectionNameFor, DEFAULT_CHUNKING, indexDocument, splitText } from "./indexDocument.js"

const paragraph = (topic, n = 12) =>
    Array.from({ length: n }, (_, i) => `${topic} sentence number ${i} explains one more detail about ${topic}.`).join(" ")

const TEXT = [paragraph("redis"), paragraph("mongodb"), paragraph("qdrant"), paragraph("gateway")].join("\n\n")

let qdrant
let embeddings

beforeEach(() => {
    resetRag()
    qdrant = createFakeQdrant()
    embeddings = createFakeEmbeddings()
    configureRag({ qdrant, embeddings })
})

describe("collectionNameFor", () => {
    it("is stable for the same text and settings", () => {
        expect(collectionNameFor(TEXT, DEFAULT_CHUNKING)).toBe(collectionNameFor(TEXT, DEFAULT_CHUNKING))
        expect(collectionNameFor(TEXT)).toMatch(/^pdf-[0-9a-f]{32}$/)
    })

    it("changes when the text or the chunk settings change", () => {
        const base = collectionNameFor(TEXT, { chunkSize: 1000, chunkOverlap: 200 })
        expect(collectionNameFor(`${TEXT}!`, { chunkSize: 1000, chunkOverlap: 200 })).not.toBe(base)
        expect(collectionNameFor(TEXT, { chunkSize: 500, chunkOverlap: 200 })).not.toBe(base)
        expect(collectionNameFor(TEXT, { chunkSize: 1000, chunkOverlap: 100 })).not.toBe(base)
    })
})

describe("splitText", () => {
    it("respects the chunk size", async () => {
        const chunks = await splitText(TEXT, { chunkSize: 300, chunkOverlap: 50 })
        expect(chunks.length).toBeGreaterThan(4)
        for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300)
    })
})

describe("indexDocument", () => {
    it("embeds every chunk once and stores dense + BM25 vectors with the text", async () => {
        const out = await indexDocument(TEXT, { chunkSize: 300, chunkOverlap: 50, source: "notes.pdf" })
        expect(out.reused).toBe(false)
        expect(embeddings.documentCalls).toBe(1)

        const stored = qdrant.collections.get(out.collectionName)
        expect(stored.points.size).toBe(out.chunkCount)
        expect(stored.config.sparse_vectors.bm25.modifier).toBe("idf")
        const first = stored.points.get(0)
        expect(first.payload).toMatchObject({ chunkIndex: 0, source: "notes.pdf", chunkSize: 300, chunkOverlap: 50 })
        expect(first.vector.dense).toHaveLength(64)
        expect(first.vector.bm25.indices.length).toBeGreaterThan(0)
    })

    it("reuses the collection for the same PDF instead of embedding again", async () => {
        const a = await indexDocument(TEXT, DEFAULT_CHUNKING)
        const b = await indexDocument(TEXT, DEFAULT_CHUNKING)
        expect(b).toEqual({ ...a, reused: true })
        expect(embeddings.documentCalls).toBe(1)
        expect(qdrant.calls.filter(([c]) => c === "createCollection")).toHaveLength(1)
        expect(qdrant.collections.size).toBe(1)
    })

    it("updates lastUsedAt when reusing", async () => {
        const { collectionName } = await indexDocument(TEXT)
        const point = qdrant.collections.get(collectionName).points.get(0)
        point.payload.lastUsedAt = 1
        await indexDocument(TEXT)
        expect(point.payload.lastUsedAt).toBeGreaterThan(1)
    })

    it("rebuilds a half-written collection", async () => {
        const { collectionName, chunkCount } = await indexDocument(TEXT, { chunkSize: 300, chunkOverlap: 50 })
        qdrant.collections.get(collectionName).points.delete(1)
        const again = await indexDocument(TEXT, { chunkSize: 300, chunkOverlap: 50 })
        expect(again.reused).toBe(false)
        expect(qdrant.collections.get(collectionName).points.size).toBe(chunkCount)
    })

    it("tolerates a parallel request creating the same collection", async () => {
        const results = await Promise.all([indexDocument(TEXT), indexDocument(TEXT)])
        expect(results[0].collectionName).toBe(results[1].collectionName)
        expect(qdrant.collections.size).toBe(1)
    })

    it("uses a new collection for different chunk settings", async () => {
        await indexDocument(TEXT, { chunkSize: 1000, chunkOverlap: 200 })
        await indexDocument(TEXT, { chunkSize: 500, chunkOverlap: 100 })
        expect(qdrant.collections.size).toBe(2)
    })

    it("refuses an empty document", async () => {
        await expect(indexDocument("   ")).rejects.toThrow(/no text/)
    })
})
