import crypto from "node:crypto"

// Shared secret that proves a request came from inside Nexora (the gateway or
// another service), not from someone calling a service's public URL directly.
// Every service reads it from the INTERNAL_API_KEY env var.

export const INTERNAL_KEY_HEADER = "x-internal-key"

const getKey = () => process.env.INTERNAL_API_KEY

// Constant-time compare. Hashing first gives both sides the same length,
// so timingSafeEqual never throws and the length is not leaked either.
export const isValidInternalKey = (provided, expected) => {
    if (typeof provided !== "string" || typeof expected !== "string" || !provided || !expected) {
        return false
    }
    const a = crypto.createHash("sha256").update(provided).digest()
    const b = crypto.createHash("sha256").update(expected).digest()
    return crypto.timingSafeEqual(a, b)
}

// Express middleware: reject anything without the right x-internal-key.
export const requireInternalKey = (req, res, next) => {
    const expected = getKey()
    if (!expected) {
        console.error("[security] INTERNAL_API_KEY is not set: refusing all internal requests. Set it on every Nexora service.")
        return res.status(503).json({ message: "service misconfigured" })
    }
    if (!isValidInternalKey(req.headers?.[INTERNAL_KEY_HEADER], expected)) {
        return res.status(403).json({ message: "forbidden" })
    }
    next()
}

// Headers for service-to-service calls (axios `headers` option).
export const internalHeaders = () => {
    const key = getKey()
    if (!key) {
        console.error("[security] INTERNAL_API_KEY is not set: internal calls will be rejected.")
        return {}
    }
    return { [INTERNAL_KEY_HEADER]: key }
}
