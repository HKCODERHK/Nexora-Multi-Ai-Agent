import { beforeEach, describe, expect, it } from "vitest"
import { configureRag, resetRag } from "./clients.js"
import { answerFromContext, NOT_FOUND_ANSWER } from "./answer.js"

const llm = {
    calls: [],
    async invoke(messages) {
        llm.calls.push(messages)
        return { content: "The coding agent allows 5 requests per minute." }
    }
}

beforeEach(() => {
    resetRag()
    llm.calls.length = 0
    configureRag({ llm })
})

describe("answerFromContext", () => {
    it("sends a system prompt plus the chunks and the question, and returns the text", async () => {
        const answer = await answerFromContext("How many coding requests per minute?", [
            { text: "The coding agent allows five requests per minute." },
            { text: "Chat allows twenty." }
        ])
        expect(answer).toBe("The coding agent allows 5 requests per minute.")
        const [system, human] = llm.calls[0]
        expect(system.content).toContain("Answer ONLY from the uploaded PDF")
        expect(system.content).toContain(NOT_FOUND_ANSWER)
        expect(human.content).toContain("The coding agent allows five requests per minute.")
        expect(human.content).toContain("Chat allows twenty.")
        expect(human.content).toContain("How many coding requests per minute?")
    })
})
