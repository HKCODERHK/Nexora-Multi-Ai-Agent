import { describe, expect, it } from "vitest"
import { answerCorrect, containsPhrase, firstHitRank, hitAtK, missingFacts, reciprocalRank, summarise } from "./metrics.js"

const chunks = ["alpha beta", "the `Map` with `incr`", "gamma\n   delta epsilon", "zeta"]

describe("phrase matching", () => {
    it("ignores case, Markdown code marks and line breaks", () => {
        expect(containsPhrase("JavaScript `Map` with `incr`", "javascript map with incr")).toBe(true)
        expect(containsPhrase("3 of 20 bills and 5 of\n   25 payments", "3 of 20 bills and 5 of 25 payments")).toBe(true)
        expect(containsPhrase("**401**", "401")).toBe(true)
    })
})

describe("retrieval metrics", () => {
    it("finds the rank of the first chunk with the phrase", () => {
        expect(firstHitRank(chunks, "Map with incr")).toBe(2)
        expect(firstHitRank(chunks, "delta epsilon")).toBe(3)
        expect(firstHitRank(chunks, "omega")).toBeNull()
    })

    it("hit@k only looks at the top k", () => {
        expect(hitAtK(chunks, "zeta", 5)).toBe(true)
        expect(hitAtK(chunks, "zeta", 3)).toBe(false)
    })

    it("reciprocal rank is 1/rank, 0 when missing", () => {
        expect(reciprocalRank(chunks, "alpha")).toBe(1)
        expect(reciprocalRank(chunks, "Map")).toBe(0.5)
        expect(reciprocalRank(chunks, "omega")).toBe(0)
    })
})

describe("answer correctness", () => {
    it("needs every key fact", () => {
        expect(answerCorrect("Started with 35 credits and fired 20 requests", ["20", "35"])).toBe(true)
        expect(answerCorrect("Fired 20 requests", ["20", "35"])).toBe(false)
        expect(missingFacts("Fired 20 requests", ["20", "35"])).toEqual(["35"])
    })

    it("accepts any alternative inside a nested list", () => {
        expect(answerCorrect("about 2 seconds", [["two seconds", "2 seconds"]])).toBe(true)
        expect(answerCorrect("about a minute", [["two seconds", "2 seconds"]])).toBe(false)
    })

    it("an empty fact list is never correct", () => {
        expect(answerCorrect("anything", [])).toBe(false)
    })
})

describe("summarise", () => {
    it("averages hit, MRR and correctness", () => {
        const s = summarise([
            { hit: true, reciprocalRank: 1, correct: true },
            { hit: false, reciprocalRank: 0, correct: false },
            { hit: true, reciprocalRank: 0.5, correct: true },
            { hit: true, reciprocalRank: 0.5, correct: false }
        ])
        expect(s).toEqual({ questions: 4, hitAt5: 0.75, mrr: 0.5, correctness: 0.5, judge: null })
    })
})
