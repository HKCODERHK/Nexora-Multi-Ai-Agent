import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const rag = vi.hoisted(() => ({
    indexDocument: vi.fn(async () => ({ collectionName: "pdf-abc", chunkCount: 3, reused: false })),
    retrieve: vi.fn(async () => [{ text: "chunk one" }, { text: "chunk two" }]),
    answerFromContext: vi.fn(async () => "the answer")
}))

vi.mock("pdf-parse", () => ({
    PDFParse: class {
        async getText() {
            return { text: "PDF TEXT" }
        }
    }
}))
vi.mock("../rag/index.js", () => ({
    ...rag,
    DEFAULT_CHUNKING: { chunkSize: 1000, chunkOverlap: 200 },
    DEFAULT_RETRIEVAL: { k: 5, mode: "dense" }
}))
vi.mock("../config/agentLimit.js", () => ({ checkAgentLimit: vi.fn(async () => ({ remaining: 4, limit: 5 })) }))
vi.mock("../utils/deductCredits.js", () => ({ deductCredits: vi.fn(async () => ({ success: true })) }))

const { checkAgentLimit } = await import("../config/agentLimit.js")
const { deductCredits } = await import("../utils/deductCredits.js")
const { pdfRag } = await import("./pdfRag.agent.js")

const tempPdf = () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nexora-")), "doc.pdf")
    fs.writeFileSync(file, "%PDF-fake")
    return file
}

describe("pdfRag agent", () => {
    beforeEach(() => vi.clearAllMocks())

    it("parses, indexes, retrieves top 5 (dense), answers, charges and deletes the upload", async () => {
        const file = tempPdf()
        const state = { userId: "u1", prompt: "What is in it?", file: { path: file, originalname: "doc.pdf" } }
        const out = await pdfRag(state)

        expect(checkAgentLimit).toHaveBeenCalledWith("u1", "pdf")
        expect(rag.indexDocument).toHaveBeenCalledWith("PDF TEXT", { chunkSize: 1000, chunkOverlap: 200, source: "doc.pdf" })
        expect(rag.retrieve).toHaveBeenCalledWith("What is in it?", { collectionName: "pdf-abc", k: 5, mode: "dense" })
        expect(rag.answerFromContext).toHaveBeenCalledWith("What is in it?", [{ text: "chunk one" }, { text: "chunk two" }])
        expect(deductCredits).toHaveBeenCalledWith("u1", "pdf")
        expect(out.aiResponse).toBe("the answer")
        expect(fs.existsSync(file)).toBe(false)
    })

    it("returns the rate-limit message and does not charge when the limit is hit", async () => {
        checkAgentLimit.mockRejectedValueOnce(Object.assign(new Error("limit"), { data: { message: "You have reached the pdf limit" } }))
        vi.spyOn(console, "log").mockImplementation(() => {})
        const file = tempPdf()
        const out = await pdfRag({ userId: "u1", prompt: "q", file: { path: file, originalname: "doc.pdf" } })
        expect(out.aiResponse).toBe("You have reached the pdf limit")
        expect(deductCredits).not.toHaveBeenCalled()
        expect(fs.existsSync(file)).toBe(false)
    })
})
