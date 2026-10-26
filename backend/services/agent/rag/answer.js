import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { getAnswerModel } from "./clients.js"

export const NOT_FOUND_ANSWER = "I couldn't find this information in the uploaded PDF."

export const SYSTEM_PROMPT = `You are NEXORA AI PDF Assistant.

Rules:

- Answer ONLY from the uploaded PDF.

- Never make up information.

- If the answer is not present in the PDF, reply:

"${NOT_FOUND_ANSWER}"

- Use Markdown formatting.
`

export const buildMessages = (query, chunks) => {
    const context = chunks.map((c) => c.text ?? c).join("\n\n")
    return [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(`
    Context:${context}
     Question:${query}
    `)
    ]
}

// Ask the LLM to answer the question using only the retrieved chunks.
export const answerFromContext = async (query, chunks) => {
    const llm = await getAnswerModel()
    const response = await llm.invoke(buildMessages(query, chunks))
    return typeof response.content === "string" ? response.content : String(response.content ?? "")
}
