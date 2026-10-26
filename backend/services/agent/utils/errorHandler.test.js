import { describe, expect, it, vi } from "vitest"
import { fakeReq, fakeRes } from "../../../test-utils/fakeHttp.js"
import { errorHandler } from "./errorHandler.js"

vi.spyOn(console, "log").mockImplementation(() => {})

describe("agent errorHandler", () => {
    it("passes through a rate-limit error's status and data", () => {
        const err = Object.assign(new Error("limit"), { status: 429, data: { limit: 5 } })
        const res = fakeRes()
        errorHandler(err, fakeReq(), res, () => {})
        expect(res.statusCode).toBe(429)
        expect(res.body).toEqual({ limit: 5 })
    })

    it("returns a 500 with the error message instead of crashing on an undefined variable", () => {
        const res = fakeRes()
        expect(() => errorHandler(new Error("boom"), fakeReq(), res, () => {})).not.toThrow()
        expect(res.statusCode).toBe(500)
        expect(res.body.message).toBe("agent error boom")
    })
})
