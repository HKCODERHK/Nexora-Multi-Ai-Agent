import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeNext, fakeReq, fakeRes } from "../../test-utils/fakeHttp.js"

vi.mock("../../shared/redis/redis.js", async () => ({
    default: (await import("../../test-utils/fakeRedis.js")).createFakeRedis()
}))

const { default: redis } = await import("../../shared/redis/redis.js")
const { default: protect } = await import("./auth.middleware.js")

describe("gateway protect middleware", () => {
    beforeEach(() => redis.reset())

    it("returns 401 and does not call next when there is no session cookie", async () => {
        const res = fakeRes()
        const next = fakeNext()
        await protect(fakeReq(), res, next)
        expect(res.statusCode).toBe(401)
        expect(next.calls).toHaveLength(0)
    })

    it("returns 401 when the cookie points to a session that is not in Redis", async () => {
        const res = fakeRes()
        const next = fakeNext()
        await protect(fakeReq({ cookies: { session: "expired-id" } }), res, next)
        expect(res.statusCode).toBe(401)
        expect(res.body.message).toBe("session expired")
        expect(next.calls).toHaveLength(0)
    })

    it("sets req.user and calls next once for a valid session", async () => {
        const user = { userId: "u1", name: "Asha", credits: 100 }
        await redis.set("session-abc", JSON.stringify(user), "EX", 60)
        const req = fakeReq({ cookies: { session: "abc" } })
        const res = fakeRes()
        const next = fakeNext()
        await protect(req, res, next)
        expect(req.user).toEqual(user)
        expect(next.calls).toEqual([undefined])
        expect(res.body).toBeUndefined()
    })
})
