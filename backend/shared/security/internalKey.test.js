import express from "express"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeNext, fakeReq, fakeRes } from "../../test-utils/fakeHttp.js"
import { INTERNAL_KEY_HEADER, internalHeaders, isValidInternalKey, requireInternalKey } from "./internalKey.js"

const KEY = "test-internal-key-not-a-secret"

describe("isValidInternalKey", () => {
    it("accepts the exact key", () => {
        expect(isValidInternalKey(KEY, KEY)).toBe(true)
    })

    it.each([
        ["wrong value", "nope"],
        ["prefix of the key", KEY.slice(0, 5)],
        ["key plus extra", `${KEY}x`],
        ["empty string", ""],
        ["undefined", undefined],
        ["array header", [KEY]]
    ])("rejects %s", (_label, provided) => {
        expect(isValidInternalKey(provided, KEY)).toBe(false)
    })

    it("rejects everything when no key is configured", () => {
        expect(isValidInternalKey("", "")).toBe(false)
        expect(isValidInternalKey("x", undefined)).toBe(false)
    })
})

describe("requireInternalKey middleware", () => {
    const original = process.env.INTERNAL_API_KEY
    beforeEach(() => {
        process.env.INTERNAL_API_KEY = KEY
    })
    afterEach(() => {
        if (original === undefined) delete process.env.INTERNAL_API_KEY
        else process.env.INTERNAL_API_KEY = original
        vi.restoreAllMocks()
    })

    it("calls next with the right key", () => {
        const next = fakeNext()
        const res = fakeRes()
        requireInternalKey(fakeReq({ headers: { [INTERNAL_KEY_HEADER]: KEY } }), res, next)
        expect(next.calls).toHaveLength(1)
        expect(res.body).toBeUndefined()
    })

    it("returns 403 without the header", () => {
        const next = fakeNext()
        const res = fakeRes()
        requireInternalKey(fakeReq(), res, next)
        expect(res.statusCode).toBe(403)
        expect(next.calls).toHaveLength(0)
    })

    it("returns 403 with a wrong key", () => {
        const res = fakeRes()
        requireInternalKey(fakeReq({ headers: { [INTERNAL_KEY_HEADER]: "guess" } }), res, fakeNext())
        expect(res.statusCode).toBe(403)
    })

    it("refuses with 503 and logs a clear error when INTERNAL_API_KEY is missing", () => {
        delete process.env.INTERNAL_API_KEY
        const log = vi.spyOn(console, "error").mockImplementation(() => {})
        const res = fakeRes()
        const next = fakeNext()
        requireInternalKey(fakeReq({ headers: { [INTERNAL_KEY_HEADER]: "" } }), res, next)
        expect(res.statusCode).toBe(503)
        expect(next.calls).toHaveLength(0)
        expect(log).toHaveBeenCalledWith(expect.stringContaining("INTERNAL_API_KEY"))
    })

    it("internalHeaders() carries the key for service-to-service calls", () => {
        expect(internalHeaders()).toEqual({ [INTERNAL_KEY_HEADER]: KEY })
    })

    it("internalHeaders() is empty (and logs) when the key is missing", () => {
        delete process.env.INTERNAL_API_KEY
        const log = vi.spyOn(console, "error").mockImplementation(() => {})
        expect(internalHeaders()).toEqual({})
        expect(log).toHaveBeenCalled()
    })

    it("in a service: health check stays open, every other route needs the key", async () => {
        // same layout as services/*/index.js
        const app = express()
        app.use(express.json())
        app.get("/", (req, res) => res.json({ message: "hello" }))
        app.use(requireInternalKey)
        app.post("/update-plan", (req, res) => res.json({ userId: req.headers["x-user-id"] ?? null }))

        await request(app).get("/").expect(200)
        await request(app).post("/update-plan").set("x-user-id", "attacker").expect(403)
        const ok = await request(app).post("/update-plan").set(INTERNAL_KEY_HEADER, KEY).set("x-user-id", "u1").expect(200)
        expect(ok.body.userId).toBe("u1")
    })
})
