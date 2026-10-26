import proxy from "express-http-proxy"
import { internalHeaders } from "../../shared/security/internalKey.js"

export const proxyWithHeader = (serviceUrl) => {
    return proxy(serviceUrl, {
        proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
            // never trust identity or key headers sent by the browser
            delete proxyReqOpts.headers["x-user-id"]
            delete proxyReqOpts.headers["x-internal-key"]
            if (srcReq.user) {
                proxyReqOpts.headers["x-user-id"] = srcReq.user.userId
            }
            Object.assign(proxyReqOpts.headers, internalHeaders())
            return proxyReqOpts
        }
    })
}
