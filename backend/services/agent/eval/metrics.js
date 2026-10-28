// Deterministic scoring for the RAG evaluation. No LLM involved.

// Lower-case, drop Markdown emphasis/code marks and collapse whitespace, so
// "`Map`" in a chunk or "**Map**" in an answer both match "map".
export const normalise = (text) =>
    String(text ?? "")
        .toLowerCase()
        .replace(/[`*_]/g, "")
        .replace(/\s+/g, " ")
        .trim()

export const containsPhrase = (text, phrase) => normalise(text).includes(normalise(phrase))

// 1-based rank of the first chunk that contains the phrase, or null.
export const firstHitRank = (chunks, phrase) => {
    const index = chunks.findIndex((c) => containsPhrase(c.text ?? c, phrase))
    return index === -1 ? null : index + 1
}

// hit@k: at least one of the top k chunks contains the phrase.
export const hitAtK = (chunks, phrase, k = 5) => {
    const rank = firstHitRank(chunks.slice(0, k), phrase)
    return rank !== null
}

// Reciprocal rank: 1 for rank 1, 1/2 for rank 2 … 0 when not retrieved. MRR = mean over questions.
export const reciprocalRank = (chunks, phrase) => {
    const rank = firstHitRank(chunks, phrase)
    return rank === null ? 0 : 1 / rank
}

// A key fact is a string, or an array of accepted alternatives ("two seconds" / "2 seconds").
const factPresent = (answer, fact) =>
    Array.isArray(fact) ? fact.some((alt) => containsPhrase(answer, alt)) : containsPhrase(answer, fact)

// Correct only when every key fact appears in the answer (case-insensitive).
export const answerCorrect = (answer, keyFacts) => keyFacts.length > 0 && keyFacts.every((f) => factPresent(answer, f))

export const missingFacts = (answer, keyFacts) => keyFacts.filter((f) => !factPresent(answer, f))

export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)

export const summarise = (rows) => ({
    questions: rows.length,
    hitAt5: mean(rows.map((r) => (r.hit ? 1 : 0))),
    mrr: mean(rows.map((r) => r.reciprocalRank)),
    correctness: mean(rows.map((r) => (r.correct ? 1 : 0))),
    judge: rows.some((r) => r.judge !== undefined) ? mean(rows.map((r) => (r.judge ? 1 : 0))) : null
})
