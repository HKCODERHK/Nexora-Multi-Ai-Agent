import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { blockInternalAuthRoutes } from "./middleware/internalRoutes.middleware.js"

// Same mount order as gateway/index.js, with a stand-in for the auth proxy
// that echoes the path it would have forwarded.
const buildApp = () => {
    const app = express()
    app.use("/api/auth", blockInternalAuthRoutes, (req, res) => {
        res.status(200).json({ forwarded: req.path })
    })
    return app
}

describe("gateway blocks internal auth routes", () => {
    const app = buildApp()

    it.each([
        "/api/auth/update-plan",
        "/api/auth/deduct-credits"
    ])("POST %s → 404 and never reaches the auth service", async (path) => {
        const res = await request(app).post(path).send({ userId: "attacker", plan: "pro", credits: 9999 })
        expect(res.status).toBe(404)
        expect(res.body.forwarded).toBeUndefined()
    })

    it.each([
        "/api/auth/UPDATE-PLAN",
        "/api/auth/update-plan/",
        "/api/auth//update-plan",
        "/api/auth/update%2Dplan",
        "/api/auth/Deduct-Credits/"
    ])("blocks the variant %s too", async (path) => {
        const res = await request(app).post(path).send({})
        expect(res.status).toBe(404)
    })

    it("GET is blocked as well", async () => {
        const res = await request(app).get("/api/auth/update-plan")
        expect(res.status).toBe(404)
    })

    it.each(["/api/auth/login", "/api/auth/logout"])("public route %s is still forwarded", async (path) => {
        const res = await request(app).post(path).send({})
        expect(res.status).toBe(200)
        expect(res.body.forwarded).toBe(path.replace("/api/auth", ""))
    })
})
