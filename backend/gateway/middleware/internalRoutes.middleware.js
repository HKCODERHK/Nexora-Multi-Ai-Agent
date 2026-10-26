// Auth-service routes that only other services may call (billing → update-plan,
// agent → deduct-credits). They call the auth service directly, so the gateway
// never needs to forward them: from the outside they simply don't exist.
const INTERNAL_AUTH_ROUTES = new Set(["/update-plan", "/deduct-credits"])

// Express matches routes case-insensitively and ignores a trailing slash,
// so compare a normalised path: decoded, lower-case, no duplicate or trailing slashes.
const normalise = (path) => {
    let p = path || "/"
    try {
        p = decodeURIComponent(p)
    } catch {
        // malformed escape: keep the raw path
    }
    p = p.toLowerCase().replace(/\/+/g, "/")
    if (p.length > 1) p = p.replace(/\/+$/, "")
    return p
}

// Mount on "/api/auth" before the auth proxy.
export const blockInternalAuthRoutes = (req, res, next) => {
    if (INTERNAL_AUTH_ROUTES.has(normalise(req.path))) {
        return res.status(404).json({ message: "not found" })
    }
    next()
}
