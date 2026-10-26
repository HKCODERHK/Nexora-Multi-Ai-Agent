// In-memory stand-in for the ioredis client in shared/redis/redis.js.
// Tests use it through:
//   vi.mock("<path>/shared/redis/redis.js", async () => ({ default: (await import("<path>/test-utils/fakeRedis.js")).createFakeRedis() }))
// It never opens a network connection.

export const createFakeRedis = () => {
    const store = new Map()
    const expiresAt = new Map()
    const calls = []

    const isExpired = (key) => expiresAt.has(key) && expiresAt.get(key) <= Date.now()
    const purge = (key) => {
        if (isExpired(key)) {
            store.delete(key)
            expiresAt.delete(key)
        }
    }

    return {
        calls,
        store,
        async incr(key) {
            calls.push(["incr", key])
            purge(key)
            const next = Number(store.get(key) || 0) + 1
            store.set(key, String(next))
            return next
        },
        async expire(key, seconds) {
            calls.push(["expire", key, seconds])
            if (!store.has(key)) return 0
            expiresAt.set(key, Date.now() + seconds * 1000)
            return 1
        },
        async ttl(key) {
            calls.push(["ttl", key])
            purge(key)
            if (!store.has(key)) return -2
            if (!expiresAt.has(key)) return -1
            return Math.ceil((expiresAt.get(key) - Date.now()) / 1000)
        },
        async get(key) {
            calls.push(["get", key])
            purge(key)
            return store.has(key) ? store.get(key) : null
        },
        // supports set(key, value) and set(key, value, "EX", seconds)
        async set(key, value, mode, seconds) {
            calls.push(["set", key, value, mode, seconds])
            store.set(key, String(value))
            if (mode === "EX") {
                expiresAt.set(key, Date.now() + seconds * 1000)
            } else {
                expiresAt.delete(key)
            }
            return "OK"
        },
        async del(key) {
            calls.push(["del", key])
            expiresAt.delete(key)
            return store.delete(key) ? 1 : 0
        },
        on() {},
        reset() {
            store.clear()
            expiresAt.clear()
            calls.length = 0
        }
    }
}
