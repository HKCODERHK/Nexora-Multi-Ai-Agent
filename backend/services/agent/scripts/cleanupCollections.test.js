import { describe, expect, it } from "vitest"
import { createFakeQdrant } from "../../../test-utils/fakeQdrant.js"
import { cleanupCollections, findStaleCollections } from "./cleanupCollections.js"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 27)

const setup = async () => {
    const qdrant = createFakeQdrant()
    const add = async (name, payload) => {
        await qdrant.createCollection(name, {})
        if (payload) await qdrant.upsert(name, { points: [{ id: 0, vector: {}, payload }] })
    }
    await add("pdf-fresh", { createdAt: NOW - 20 * DAY, lastUsedAt: NOW - 1 * DAY })
    await add("pdf-old", { createdAt: NOW - 20 * DAY, lastUsedAt: NOW - 10 * DAY })
    await add(`pdf-${NOW - 30 * DAY}`) // legacy pdf-<Date.now()> name
    await add("pdf-empty")
    await add("other-collection", { createdAt: 0 })
    return qdrant
}

describe("cleanupCollections", () => {
    it("finds pdf collections not used for N days, including legacy and empty ones", async () => {
        const stale = await findStaleCollections(await setup(), { days: 7, now: NOW })
        expect(stale.map((s) => s.name).sort()).toEqual([`pdf-${NOW - 30 * DAY}`, "pdf-empty", "pdf-old"].sort())
    })

    it("is a dry run by default and deletes nothing", async () => {
        const qdrant = await setup()
        const lines = []
        await cleanupCollections(qdrant, { days: 7, now: NOW, log: (l) => lines.push(l) })
        expect(qdrant.collections.size).toBe(5)
        expect(lines.at(-1)).toContain("dry run")
    })

    it("deletes only the stale ones when dryRun is false", async () => {
        const qdrant = await setup()
        await cleanupCollections(qdrant, { days: 7, now: NOW, dryRun: false, log: () => {} })
        expect([...qdrant.collections.keys()].sort()).toEqual(["other-collection", "pdf-fresh"])
    })
})
