// Delete PDF collections in Qdrant that have not been used for N days.
//
//   node scripts/cleanupCollections.js                # dry run, 7 days
//   node scripts/cleanupCollections.js --days 30      # dry run, 30 days
//   node scripts/cleanupCollections.js --days 30 --delete
//
// Uses QDRANT_URL / QDRANT_API_KEY. Without --delete it only prints what it would remove.
import { pathToFileURL } from "node:url"
import { COLLECTION_PREFIX } from "../rag/indexDocument.js"

const DAY = 24 * 60 * 60 * 1000

// Old Nexora collections were named pdf-<Date.now()>; new ones keep lastUsedAt/createdAt on point 0.
const lastUsed = async (qdrant, name) => {
    const legacy = name.match(/^pdf-(\d{13})$/)
    if (legacy) return Number(legacy[1])
    const { points } = await qdrant.scroll(name, { limit: 1, with_payload: true, with_vector: false })
    const payload = points?.[0]?.payload
    return payload?.lastUsedAt ?? payload?.createdAt ?? null
}

export const findStaleCollections = async (qdrant, { days = 7, now = Date.now() } = {}) => {
    const cutoff = now - days * DAY
    const { collections } = await qdrant.getCollections()
    const stale = []
    for (const { name } of collections) {
        if (!name.startsWith(COLLECTION_PREFIX)) continue
        const used = await lastUsed(qdrant, name)
        // empty collection with no timestamp: a failed upload, safe to remove
        if (used === null || used < cutoff) stale.push({ name, lastUsedAt: used })
    }
    return stale
}

export const cleanupCollections = async (qdrant, { days = 7, dryRun = true, now, log = console.log } = {}) => {
    const stale = await findStaleCollections(qdrant, { days, now })
    for (const { name, lastUsedAt } of stale) {
        const when = lastUsedAt ? new Date(lastUsedAt).toISOString() : "unknown"
        if (dryRun) {
            log(`[dry run] would delete ${name} (last used ${when})`)
        } else {
            await qdrant.deleteCollection(name)
            log(`deleted ${name} (last used ${when})`)
        }
    }
    log(`${stale.length} collection(s) older than ${days} day(s)${dryRun ? " — dry run, nothing deleted (pass --delete)" : " deleted"}`)
    return stale
}

const parseArgs = (argv) => {
    const daysIndex = argv.indexOf("--days")
    const days = daysIndex >= 0 ? Number(argv[daysIndex + 1]) : 7
    if (!Number.isFinite(days) || days < 0) throw new Error("--days must be a non-negative number")
    return { days, dryRun: !argv.includes("--delete") }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const { default: dotenv } = await import("dotenv")
    dotenv.config()
    const { getQdrant } = await import("../rag/clients.js")
    await cleanupCollections(getQdrant(), parseArgs(process.argv.slice(2)))
}
