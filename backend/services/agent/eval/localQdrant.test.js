import { describe, expect, it } from "vitest"
import { assertLocalQdrantUrl } from "./localQdrant.js"

describe("assertLocalQdrantUrl", () => {
    it.each(["http://localhost:6333", "http://127.0.0.1:6333", "http://[::1]:6333"])("allows %s", (url) => {
        expect(assertLocalQdrantUrl(url)).toBe(url)
    })

    it.each([
        "https://abc.eu-central.aws.cloud.qdrant.io:6333",
        "http://localhost.evil.example:6333",
        "http://10.0.0.5:6333",
        "not a url"
    ])("refuses %s", (url) => {
        expect(() => assertLocalQdrantUrl(url)).toThrow()
    })
})
