import express from "express"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { proxyWithHeader } from "./proxyWithHeader.js"

// A local upstream on 127.0.0.1 that echoes the headers it received.
let upstream
let upstreamUrl
const KEY = "test-internal-key-not-a-secret"
const original = process.env.INTERNAL_API_KEY

beforeAll(async () => {
    process.env.INTERNAL_API_KEY = KEY
    const app = express()
    app.use((req, res) => res.json({
        userId: req.headers["x-user-id"] ?? null,
        key: req.headers["x-internal-key"] ?? null
    }))
    await new Promise((resolve) => {
        upstream = app.listen(0, "127.0.0.1", resolve)
    })
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`
})

afterAll(() => {
    upstream?.close()
    if (original === undefined) delete process.env.INTERNAL_API_KEY
    else process.env.INTERNAL_API_KEY = original
})

const gateway = (user) => {
    const app = express()
    app.use((req, res, next) => {
        if (user) req.user = user
        next()
    })
    app.use("/api/x", proxyWithHeader(upstreamUrl))
    return app
}

describe("proxyWithHeader", () => {
    it("adds the internal key and the session's user id", async () => {
        const res = await request(gateway({ userId: "u1" })).get("/api/x/anything")
        expect(res.body).toEqual({ userId: "u1", key: KEY })
    })

    it("drops a forged x-user-id and x-internal-key from the browser", async () => {
        const res = await request(gateway(null))
            .get("/api/x/anything")
            .set("x-user-id", "someone-else")
            .set("x-internal-key", "forged")
        expect(res.body).toEqual({ userId: null, key: KEY })
    })

    it("replaces a forged x-user-id with the real session user", async () => {
        const res = await request(gateway({ userId: "u1" }))
            .get("/api/x/anything")
            .set("x-user-id", "someone-else")
        expect(res.body.userId).toBe("u1")
    })
})
