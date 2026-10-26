import { beforeEach, describe, expect, it } from "vitest"
import { createFakeEmbeddings, createFakeQdrant } from "../../../test-utils/fakeQdrant.js"
import { configureRag, resetRag } from "./clients.js"
import { indexDocument } from "./indexDocument.js"
import { retrieve } from "./retrieve.js"

const CHUNKS = [
    "The gateway checks the session cookie in Redis before proxying a request.",
    "Credits are deducted with an atomic findOneAndUpdate so the balance never goes negative.",
    "The coding agent allows five requests per minute for each user.",
    "Uploaded PDFs are split into chunks, embedded with gemini-embedding-001 and stored in Qdrant.",
    "Error code NX-4021 means the billing webhook signature did not match."
]
const TEXT = CHUNKS.join("\n\n")

let collectionName
let embeddings

beforeEach(async () => {
    resetRag()
    embeddings = createFakeEmbeddings()
    configureRag({ qdrant: createFakeQdrant(), embeddings })
    // chunkSize just above the longest line, so each line is one chunk
    ;({ collectionName } = await indexDocument(TEXT, { chunkSize: 100, chunkOverlap: 0 }))
})

describe("retrieve", () => {
    it("dense mode returns k chunks ranked by similarity, with text, score, rank and source", async () => {
        const out = await retrieve("how are credits deducted atomically", { collectionName, k: 3, mode: "dense" })
        expect(out).toHaveLength(3)
        expect(out[0].text).toContain("findOneAndUpdate")
        expect(out.map((c) => c.rank)).toEqual([1, 2, 3])
        expect(out[0].score).toBeGreaterThanOrEqual(out[1].score)
        expect(out[0].source).toBe("document")
    })

    it("defaults to dense top 5", async () => {
        const out = await retrieve("session cookie", { collectionName })
        expect(out).toHaveLength(5)
        expect(embeddings.queryCalls).toBe(1)
    })

    it("rejects an unknown mode and a missing collection", async () => {
        await expect(retrieve("x", { collectionName, mode: "magic" })).rejects.toThrow(/Unknown retrieval mode/)
        await expect(retrieve("x", {})).rejects.toThrow(/collectionName/)
    })
})
