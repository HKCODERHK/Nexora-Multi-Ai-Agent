import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../shared/redis/redis.js", async () => ({
    default: (await import("../../../test-utils/fakeRedis.js")).createFakeRedis()
}))

const { default: redis } = await import("../../../shared/redis/redis.js")
const { checkAgentLimit } = await import("./agentLimit.js")

describe("checkAgentLimit (per user, per agent, per minute)", () => {
    beforeEach(() => redis.reset())

    it("allows 5 coding calls and rejects the 6th with 429", async () => {
        for (let i = 0; i < 5; i++) {
            await checkAgentLimit("u1", "coding")
        }
        const error = await checkAgentLimit("u1", "coding").catch((e) => e)
        expect(error).toBeInstanceOf(Error)
        expect(error.status).toBe(429)
        expect(error.data.limit).toBe(5)
        expect(error.data.agent).toBe("coding")
        expect(error.data.remainingTime).toBeGreaterThan(0)
    })

    it("counts remaining down 4, 3, 2, 1, 0", async () => {
        const remaining = []
        for (let i = 0; i < 5; i++) {
            remaining.push((await checkAgentLimit("u1", "coding")).remaining)
        }
        expect(remaining).toEqual([4, 3, 2, 1, 0])
    })

    it("sets the 60s expiry only on the first call", async () => {
        for (let i = 0; i < 3; i++) {
            await checkAgentLimit("u1", "coding")
        }
        const expires = redis.calls.filter(([cmd]) => cmd === "expire")
        expect(expires).toEqual([["expire", "rate:u1:coding", 60]])
    })

    it("keeps a separate counter for each user", async () => {
        for (let i = 0; i < 5; i++) {
            await checkAgentLimit("u1", "coding")
        }
        await expect(checkAgentLimit("u1", "coding")).rejects.toMatchObject({ status: 429 })
        await expect(checkAgentLimit("u2", "coding")).resolves.toEqual({ remaining: 4, limit: 5 })
    })

    it("uses the chat limit (20) for an unknown agent", async () => {
        const first = await checkAgentLimit("u1", "somethingNew")
        expect(first).toEqual({ remaining: 19, limit: 20 })
    })
})
