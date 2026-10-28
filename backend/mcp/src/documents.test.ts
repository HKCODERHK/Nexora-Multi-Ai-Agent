import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
// @ts-expect-error plain JS test helper
import { createFakeEmbeddings, createFakeQdrant } from "../../test-utils/fakeQdrant.js"
// @ts-expect-error plain JS module from the agent service
import * as rag from "../../services/agent/rag/index.js"
import { DocumentLibrary, type RagModule } from "./documents.js"

const writeDocs = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexora-mcp-"))
    fs.writeFileSync(path.join(dir, "limits.md"), "The coding agent allows five requests per minute.\n\nChat allows twenty requests per minute.")
    fs.writeFileSync(path.join(dir, "errors.txt"), "Error code NX-4021 means the billing webhook signature did not match.")
    fs.writeFileSync(path.join(dir, "empty.md"), "   ")
    fs.writeFileSync(path.join(dir, "notes.docx"), "ignored: unsupported type")
    return dir
}

let qdrant: ReturnType<typeof createFakeQdrant>

beforeEach(() => {
    rag.resetRag()
    qdrant = createFakeQdrant()
    rag.configureRag({ qdrant, embeddings: createFakeEmbeddings() })
})

const library = (mode: "dense" | "hybrid" = "hybrid") =>
    new DocumentLibrary({ docsDir: writeDocs(), mode, rag: async () => rag as unknown as RagModule })

describe("DocumentLibrary (MCP tools)", () => {
    it("list_documents: indexes every supported, non-empty file once", async () => {
        const lib = library()
        const docs = await lib.documents()
        expect(docs.map((d) => d.name)).toEqual(["errors.txt", "limits.md"])
        expect(docs.every((d) => d.chunkCount >= 1 && d.collectionName.startsWith("pdf-"))).toBe(true)
        await lib.documents()
        expect(qdrant.collections.size).toBe(2)
    })

    it("search_documents: returns the top k chunks across documents with score and source", async () => {
        const hits = await library().search("NX-4021 webhook signature", 2)
        expect(hits).toHaveLength(2)
        expect(hits[0]).toMatchObject({ source: "errors.txt", rank: 1 })
        expect(hits[0].text).toContain("NX-4021")
        expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score)
    })

    it("works in dense mode too", async () => {
        const hits = await library("dense").search("coding agent requests per minute", 1)
        expect(hits[0].source).toBe("limits.md")
    })

    it("reports a missing folder and can retry later", async () => {
        const lib = new DocumentLibrary({ docsDir: path.join(os.tmpdir(), "does-not-exist-nexora"), rag: async () => rag as unknown as RagModule })
        await expect(lib.documents()).rejects.toThrow(/not found/)
        await expect(lib.documents()).rejects.toThrow(/not found/)
    })
})
