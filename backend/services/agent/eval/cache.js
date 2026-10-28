import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// Disk caches so re-running the evaluation does not spend free-tier quota again.
// eval/.cache is git-ignored.

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex")

const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
        return undefined
    }
}

const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isRateLimit = (error) =>
    error?.status === 429 || error?.response?.status === 429 || /429|rate.?limit|quota|too many requests/i.test(error?.message ?? "")

// Retry a free-tier call on 429 with a growing pause.
export const withRetry = async (fn, { attempts = 8, baseMs = 15000, label = "call", log = console.warn } = {}) => {
    for (let attempt = 1; ; attempt++) {
        try {
            return await fn()
        } catch (error) {
            if (!isRateLimit(error) || attempt >= attempts) throw error
            const wait = baseMs * attempt
            log(`  rate limited on ${label}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${attempts})`)
            await sleep(wait)
        }
    }
}

export const createStats = () => ({ embeddingHits: 0, embeddingMisses: 0, llmHits: 0, llmMisses: 0 })

// Wraps a LangChain Embeddings object. Each text is embedded once per model, ever.
export const cachedEmbeddings = (base, { dir, model, stats = createStats(), batchSize = 50 }) => {
    const fileFor = (kind, text) => path.join(dir, "embeddings", `${sha(`${model}|${kind}|${text}`)}.json`)
    return {
        stats,
        async embedDocuments(texts) {
            const out = texts.map((t) => readJson(fileFor("doc", t)))
            const missing = out.map((v, i) => (v ? null : i)).filter((i) => i !== null)
            stats.embeddingHits += texts.length - missing.length
            stats.embeddingMisses += missing.length
            for (let start = 0; start < missing.length; start += batchSize) {
                const batch = missing.slice(start, start + batchSize)
                const vectors = await withRetry(() => base.embedDocuments(batch.map((i) => texts[i])), { label: "embeddings" })
                batch.forEach((i, n) => {
                    out[i] = vectors[n]
                    writeJson(fileFor("doc", texts[i]), vectors[n])
                })
            }
            return out
        },
        async embedQuery(text) {
            const file = fileFor("query", text)
            const hit = readJson(file)
            if (hit) {
                stats.embeddingHits++
                return hit
            }
            stats.embeddingMisses++
            const vector = await withRetry(() => base.embedQuery(text), { label: "query embedding" })
            writeJson(file, vector)
            return vector
        }
    }
}

const serialise = (messages) =>
    JSON.stringify(
        (Array.isArray(messages) ? messages : [messages]).map((m) =>
            typeof m === "string" ? m : { type: m._getType?.() ?? m.constructor?.name, content: m.content }
        )
    )

// Wraps a LangChain chat model. The same prompt to the same model is answered from disk.
export const cachedLLM = (base, { dir, model, stats = createStats(), minIntervalMs = 0, enabled = true }) => {
    let last = 0
    return {
        stats,
        async invoke(messages) {
            const file = path.join(dir, "llm", `${sha(`${model}|${serialise(messages)}`)}.json`)
            if (enabled) {
                const hit = readJson(file)
                if (hit) {
                    stats.llmHits++
                    return hit
                }
            }
            stats.llmMisses++
            const gap = last + minIntervalMs - Date.now()
            if (gap > 0) await sleep(gap)
            const response = await withRetry(() => base.invoke(messages), { label: model })
            last = Date.now()
            const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content)
            const saved = { content }
            writeJson(file, saved)
            return saved
        }
    }
}
