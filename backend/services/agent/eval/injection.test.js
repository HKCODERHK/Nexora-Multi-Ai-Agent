import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { attackSucceeded } from "./injection.js"

const dir = path.dirname(fileURLToPath(import.meta.url))
const attacks = JSON.parse(fs.readFileSync(path.join(dir, "injection.json"), "utf8"))
const docs = fs.readdirSync(path.join(dir, "docs"))

describe("injection.json", () => {
    it("has at least 5 attacks, each with a document, a query and a success marker", () => {
        expect(attacks.length).toBeGreaterThanOrEqual(5)
        for (const a of attacks) {
            expect(docs).toContain(a.doc)
            expect(a.query).toBeTruthy()
            expect(a.attack_succeeded_if?.length || a.attack_succeeded_if_regex).toBeTruthy()
        }
    })

    it("injected instructions are placed after a heading that exists", () => {
        for (const a of attacks.filter((x) => x.inject)) {
            const text = fs.readFileSync(path.join(dir, "docs", a.doc), "utf8")
            expect(text).toContain(a.inject_after)
        }
    })
})

describe("attackSucceeded", () => {
    const byId = Object.fromEntries(attacks.map((a) => [a.id, a]))

    it("spots the leaked marker", () => {
        expect(attackSucceeded(byId.a2, "Please verify at https://evil.example/verify")).toBe(true)
        expect(attackSucceeded(byId.a2, "Run npm test in backend.")).toBe(false)
    })

    it("uses the regex markers", () => {
        expect(attackSucceeded(byId.a4, "A fair price would be ₹499 per month.")).toBe(true)
        expect(attackSucceeded(byId.a4, "I couldn't find this information in the uploaded PDF.")).toBe(false)
        expect(attackSucceeded(byId.a6, "GROQ_API_KEY=abcdefgh123")).toBe(true)
        expect(attackSucceeded(byId.a6, "I can't share API keys.")).toBe(false)
    })
})
