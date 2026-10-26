import { beforeEach, describe, expect, it, vi } from "vitest"

// Fake LLM: records every prompt and answers with whatever the test sets.
const llm = vi.hoisted(() => ({
    answer: "chat",
    calls: [],
    async invoke(prompt) {
        llm.calls.push(prompt)
        return { content: llm.answer }
    }
}))

vi.mock("../config/llmModels.js", () => ({
    getModel: vi.fn(async () => llm)
}))
// The controller pulls in the graph, axios and Redis; the router needs none of them.
vi.mock("../controllers/agent.controller.js", () => ({ agent: vi.fn() }))

const { router, ROUTABLE_AGENTS } = await import("./router.js")

describe("agent router", () => {
    beforeEach(() => {
        llm.calls.length = 0
        llm.answer = "chat"
    })

    it("keeps an explicitly chosen agent and does not call the LLM", async () => {
        const out = await router({ agent: "search", prompt: "news today" })
        expect(out.agent).toBe("search")
        expect(llm.calls).toHaveLength(0)
    })

    it("sends a PDF upload to pdfRag without calling the LLM", async () => {
        const out = await router({ agent: "auto", prompt: "summarise", file: { mimetype: "application/pdf" } })
        expect(out.agent).toBe("pdfRag")
        expect(llm.calls).toHaveLength(0)
    })

    it("sends an image upload to imageAnalyzer without calling the LLM", async () => {
        const out = await router({ agent: "auto", prompt: "what is this", file: { mimetype: "image/png" } })
        expect(out.agent).toBe("imageAnalyzer")
        expect(llm.calls).toHaveLength(0)
    })

    it("trims and lower-cases the LLM's answer for text-only requests", async () => {
        llm.answer = " Coding\n"
        const out = await router({ agent: "auto", prompt: "write a debounce in JS" })
        expect(out.agent).toBe("coding")
        expect(llm.calls).toHaveLength(1)
    })

    it("includes the user's query in the prompt sent to the LLM", async () => {
        await router({ agent: "auto", prompt: "build me a REST API for todos" })
        expect(llm.calls[0]).toContain("build me a REST API for todos")
    })

    it("treats a missing agent like auto", async () => {
        llm.answer = "search"
        const out = await router({ prompt: "latest AI news" })
        expect(out.agent).toBe("search")
    })

    it.each(["I think chat.", "banana", "", "pdfRag", "chat search"])(
        "falls back to chat when the LLM answers %j",
        async (answer) => {
            llm.answer = answer
            const out = await router({ agent: "auto", prompt: "hello" })
            expect(out.agent).toBe("chat")
        }
    )

    it("accepts every agent it advertises", async () => {
        for (const name of ROUTABLE_AGENTS) {
            llm.answer = name.toUpperCase()
            const out = await router({ agent: "auto", prompt: "x" })
            expect(out.agent).toBe(name)
        }
    })
})
