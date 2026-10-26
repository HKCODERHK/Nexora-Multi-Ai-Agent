import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import mongoose from "mongoose"
import { MongoMemoryServer } from "mongodb-memory-server"
import { fakeReq, fakeRes } from "../../../test-utils/fakeHttp.js"

// serviceAccountKey.json is not in git, so Firebase must never load for real.
vi.mock("../config/firebase.js", () => ({ app: {} }))
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn() }))
vi.mock("../../../shared/redis/redis.js", async () => ({
    default: (await import("../../../test-utils/fakeRedis.js")).createFakeRedis()
}))

const { default: redis } = await import("../../../shared/redis/redis.js")
const { default: User } = await import("../models/user.model.js")
const { deductCredits, updateUserPayment } = await import("./auth.controller.js")

let mongo

beforeAll(async () => {
    mongo = await MongoMemoryServer.create()
    await mongoose.connect(mongo.getUri())
})

afterAll(async () => {
    await mongoose.disconnect()
    await mongo?.stop()
})

beforeEach(async () => {
    await User.deleteMany({})
    redis.reset()
})

const makeUser = (credits) => User.create({ firebaseUid: `uid-${Math.random()}`, name: "Test", credits })

const callDeduct = async (body) => {
    const res = fakeRes()
    await deductCredits(fakeReq({ body }), res)
    return res
}

describe("deductCredits", () => {
    it("charges 10 for coding: 100 → 90", async () => {
        const user = await makeUser(100)
        const res = await callDeduct({ userId: user._id.toString(), agent: "coding" })
        expect(res.statusCode).toBe(200)
        expect(res.body.credits).toBe(90)
        expect((await User.findById(user._id)).credits).toBe(90)
    })

    it("refuses when the balance is too low and leaves it unchanged", async () => {
        const user = await makeUser(5)
        const res = await callDeduct({ userId: user._id.toString(), agent: "coding" })
        expect(res.statusCode).toBe(400)
        expect(res.body.message).toBe("Not enough credits.")
        expect((await User.findById(user._id)).credits).toBe(5)
    })

    it("returns user not found for an unknown id", async () => {
        const res = await callDeduct({ userId: new mongoose.Types.ObjectId().toString(), agent: "chat" })
        expect([400, 404]).toContain(res.statusCode)
        expect(res.body.message).toBe("user not found")
    })

    it("returns user not found for a malformed id instead of a 500", async () => {
        const res = await callDeduct({ userId: "not-an-id", agent: "chat" })
        expect(res.statusCode).toBe(404)
    })

    it("charges 1 for an agent that is not in the price list", async () => {
        const user = await makeUser(100)
        const res = await callDeduct({ userId: user._id.toString(), agent: "brandNewAgent" })
        expect(res.body.credits).toBe(99)
    })

    it("two parallel coding calls with exactly 10 credits: one wins, balance ends at 0", async () => {
        const user = await makeUser(10)
        const id = user._id.toString()
        const results = await Promise.all([
            callDeduct({ userId: id, agent: "coding" }),
            callDeduct({ userId: id, agent: "coding" })
        ])
        const codes = results.map((r) => r.statusCode).sort()
        expect(codes).toEqual([200, 400])
        const final = (await User.findById(user._id)).credits
        expect(final).toBe(0)
    })

    it("never goes negative under 20 parallel calls", async () => {
        const user = await makeUser(35)
        const id = user._id.toString()
        const results = await Promise.all(
            Array.from({ length: 20 }, () => callDeduct({ userId: id, agent: "coding" }))
        )
        expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3)
        expect((await User.findById(user._id)).credits).toBe(5)
    })

    it("updates the cached session only when the user has one", async () => {
        const user = await makeUser(100)
        await callDeduct({ userId: user._id.toString(), agent: "chat" })
        expect([...redis.store.keys()].some((k) => k.startsWith("session-"))).toBe(false)

        await redis.set(`user-session-${user._id}`, "sid-1")
        await callDeduct({ userId: user._id.toString(), agent: "chat" })
        expect(JSON.parse(await redis.get("session-sid-1")).credits).toBe(98)
    })
})

describe("updateUserPayment", () => {
    it("adds credits atomically even when a deduction runs at the same time", async () => {
        const user = await makeUser(10)
        const id = user._id.toString()
        const payRes = fakeRes()
        await Promise.all([
            updateUserPayment(fakeReq({ body: { userId: id, plan: "pro", credits: 500 } }), payRes),
            callDeduct({ userId: id, agent: "coding" })
        ])
        expect(payRes.statusCode).toBe(200)
        const after = await User.findById(user._id)
        expect(after.credits).toBe(500)
        expect(after.totalCredits).toBe(600)
        expect(after.plan).toBe("pro")
    })
})
