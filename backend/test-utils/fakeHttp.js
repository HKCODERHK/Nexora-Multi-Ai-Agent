// Tiny Express-like req/res/next doubles for calling controllers and middleware directly.

export const fakeRes = () => {
    const res = {
        statusCode: 200,
        body: undefined,
        headers: {},
        status(code) {
            res.statusCode = code
            return res
        },
        json(body) {
            res.body = body
            return res
        },
        cookie(name, value, options) {
            res.headers[`cookie:${name}`] = { value, options }
            return res
        },
        clearCookie(name) {
            res.headers[`cookie:${name}`] = null
            return res
        }
    }
    return res
}

export const fakeReq = ({ body = {}, cookies = {}, headers = {}, path = "/" } = {}) => ({
    body,
    cookies,
    headers,
    path,
    get(name) {
        return headers[name.toLowerCase()]
    }
})

export const fakeNext = () => {
    const next = (err) => {
        next.calls.push(err)
    }
    next.calls = []
    return next
}
