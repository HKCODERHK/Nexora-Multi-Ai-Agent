// Prompt-injection guardrail for the PDF assistant. Three layers, none perfect on its own:
// 1. input check: refuse obvious attacks before any LLM call
// 2. delimiters: retrieved chunks are wrapped and labelled as data, never instructions
// 3. output check: no system-prompt text, no secrets, no URLs that are not in the document

export const BLOCKED_ANSWER = "I can only answer questions about the uploaded PDF, using what it says."

const INPUT_PATTERNS = [
    ["override", /\b(ignore|disregard|forget|override|bypass)\b[^.?!\n]{0,40}\b(previous|prior|above|earlier|all|your|the|system)\b[^.?!\n]{0,20}\b(instructions?|rules?|prompts?|guidelines|directions)\b/i],
    ["prompt-leak", /\b(print|show|reveal|repeat|display|output|tell|give|leak|what(?:'s| is| are))\b[^.?!\n]{0,40}\b(system|hidden|initial|original|developer)\s+(prompt|instructions?|message|rules)\b/i],
    ["prompt-leak", /\b(repeat|print|output)\b[^.?!\n]{0,30}\b(everything|all text|the text)\b[^.?!\n]{0,20}\babove\b/i],
    ["secrets", /\b(print|show|reveal|tell|give|leak|list|dump|output|what(?:'s| is| are))\b[^.?!\n]{0,40}\b(your|the server'?s?|its|the)\s+(api[\s_-]?keys?|secret|secrets|tokens?|passwords?|credentials|env(ironment)?(\s+variables?|\s+vars?)?|\.env)\b/i],
    ["secrets", /\bprocess\.env\b|\b[A-Z][A-Z0-9]*_(API_KEY|SECRET|TOKEN)\b/],
    ["jailbreak", /\b(DAN|do anything now|developer mode|jailbreak|jailbroken|no (rules|restrictions|filters|limits))\b/i],
    ["jailbreak", /\b(pretend|act|behave|roleplay|role-play)\b[^.?!\n]{0,30}\b(you are|you're|as if|to be)\b[^.?!\n]{0,60}\b(unrestricted|uncensored|evil|without (any )?(rules|restrictions|limits)|no longer|not bound)\b/i],
    ["off-document", /\b(ignore|forget|don'?t use|without using|instead of)\b[^.?!\n]{0,20}\b(the|this|uploaded)?\s*(pdf|document|context)\b/i],
    ["off-document", /\b(make up|invent|fabricate|hallucinate|guess)\b[^.?!\n]{0,40}\b(answer|facts?|information|something|details?|a story|numbers?|dates?)\b/i]
]

// Leetspeak and spacing tricks ("1gn0re  prev10us") are folded before matching.
const fold = (text) =>
    String(text ?? "")
        .normalize("NFKC")
        .replace(/[0]/g, "o")
        .replace(/[1!|]/g, "i")
        .replace(/[3]/g, "e")
        .replace(/[4@]/g, "a")
        .replace(/[5$]/g, "s")
        .replace(/[​-‍﻿]/g, "")
        .replace(/\s+/g, " ")

export const checkInput = (query) => {
    const variants = [String(query ?? ""), fold(query)]
    for (const [reason, pattern] of INPUT_PATTERNS) {
        if (variants.some((v) => pattern.test(v))) return { blocked: true, reason }
    }
    return { blocked: false }
}

// Delimit each chunk; a chunk can't close its own tag to "escape" into instructions.
export const wrapChunks = (chunks) =>
    chunks
        .map((c, i) => {
            const text = String(c.text ?? c).replace(/<\/?\s*document_chunk[^>]*>/gi, "[removed tag]")
            const source = String(c.source ?? "document").replace(/["<>]/g, "")
            return `<document_chunk index="${i + 1}" source="${source}">\n${text}\n</document_chunk>`
        })
        .join("\n\n")

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()\]"'`]+|\bwww\.[^\s<>()\]"'`]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:example|com|net|org|io|ru|xyz|biz)\b(?:\/[^\s<>()\]"'`]*)?/gi

const cleanUrl = (u) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.,;:!?]+$/, "")

export const findUrls = (text) => [...String(text ?? "").matchAll(URL_PATTERN)].map((m) => m[0])

const words = (text) => String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) || []

// true when the answer copies any run of `size` consecutive words from the system prompt
export const leaksPrompt = (answer, systemPrompt, size = 8) => {
    const prompt = words(systemPrompt)
    const said = ` ${words(answer).join(" ")} `
    for (let i = 0; i + size <= prompt.length; i++) {
        if (said.includes(` ${prompt.slice(i, i + size).join(" ")} `)) return true
    }
    return false
}

// Values of env vars that look like secrets (never logged, only compared).
const secretValues = (env) =>
    Object.entries(env)
        .filter(([name, value]) => /KEY|SECRET|TOKEN|PASSWORD|URI|URL/i.test(name) && typeof value === "string" && value.length >= 8)
        .map(([, value]) => value)

export const checkOutput = (answer, { chunks = [], systemPrompt = "", env = process.env } = {}) => {
    const text = String(answer ?? "")
    if (systemPrompt && leaksPrompt(text, systemPrompt)) {
        return { blocked: true, reason: "prompt-leak", answer: BLOCKED_ANSWER }
    }
    if (secretValues(env).some((value) => text.includes(value))) {
        return { blocked: true, reason: "secret-leak", answer: BLOCKED_ANSWER }
    }
    const context = chunks.map((c) => String(c.text ?? c)).join("\n").toLowerCase()
    const foreign = findUrls(text).filter((u) => !context.includes(cleanUrl(u)))
    if (foreign.length) {
        let cleaned = text
        for (const u of foreign) cleaned = cleaned.split(u).join("[link removed]")
        return { blocked: false, reason: "foreign-url", removed: foreign, answer: cleaned }
    }
    return { blocked: false, answer: text }
}
