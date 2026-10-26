import { describe, expect, it } from "vitest"
import { reciprocalRankFusion, termId, tokenize, toSparseQuery, toSparseVector } from "./bm25.js"

describe("tokenize", () => {
    it("lower-cases, splits on punctuation and drops stopwords", () => {
        expect(tokenize("The Gateway checks the SESSION-cookie!")).toEqual(["gateway", "checks", "session", "cookie"])
    })

    it("keeps numbers and codes", () => {
        expect(tokenize("Error NX-4021 at port 6333")).toEqual(["error", "nx", "4021", "port", "6333"])
    })
})

describe("BM25 sparse vectors", () => {
    it("gives each distinct term one sorted index", () => {
        const v = toSparseVector("redis redis cache")
        expect(v.indices).toHaveLength(2)
        expect([...v.indices]).toEqual([...v.indices].sort((a, b) => a - b))
    })

    it("saturates term frequency: 2 mentions score more than 1, but less than double", () => {
        const one = toSparseVector("redis cache layer", { avgLength: 3 })
        const two = toSparseVector("redis redis layer", { avgLength: 3 })
        const w = (v, term) => v.values[v.indices.indexOf(termId(term))]
        expect(w(two, "redis")).toBeGreaterThan(w(one, "redis"))
        expect(w(two, "redis")).toBeLessThan(2 * w(one, "redis"))
    })

    it("penalises long chunks for the same term count", () => {
        const short = toSparseVector("redis cache", { avgLength: 10 })
        const long = toSparseVector("redis cache plus many many other different words here now", { avgLength: 10 })
        const w = (v) => v.values[v.indices.indexOf(termId("redis"))]
        expect(w(short)).toBeGreaterThan(w(long))
    })

    it("weights every query term once", () => {
        expect(toSparseQuery("redis redis cache").values).toEqual([1, 1])
    })
})

describe("reciprocalRankFusion", () => {
    it("ranks an item found by both lists above items found by one", () => {
        const dense = [{ id: "a" }, { id: "b" }, { id: "c" }]
        const keyword = [{ id: "c" }, { id: "d" }]
        const fused = reciprocalRankFusion([dense, keyword], { k: 60 })
        expect(fused.map((x) => x.id)).toEqual(["c", "a", "b", "d"])
        expect(fused[0].score).toBeCloseTo(1 / 63 + 1 / 61, 10)
        expect(fused[1].score).toBeCloseTo(1 / 61, 10)
    })

    it("handles an empty list", () => {
        expect(reciprocalRankFusion([[{ id: "a" }], []]).map((x) => x.id)).toEqual(["a"])
    })
})
