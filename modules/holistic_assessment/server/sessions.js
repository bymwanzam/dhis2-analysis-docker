import { randomBytes } from 'node:crypto'

/**
 * Server-side sessions, held in memory.
 *
 * A session carries the user's DHIS2 personal access token and the DHIMS URL
 * it belongs to. The token must never reach the browser or the database, so
 * sessions live only in this process. Restarting the container signs
 * everybody out, which is the safe failure.
 */

export const SESSION_COOKIE = 'ghsha_sid'

export const parseCookies = (header = '') =>
    Object.fromEntries(
        header
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const i = part.indexOf('=')
                return i < 0
                    ? [part, '']
                    : [part.slice(0, i), decodeURIComponent(part.slice(i + 1))]
            })
    )

export const createSessionStore = ({ ttlHours = 8, now = () => Date.now() } = {}) => {
    const sessions = new Map()
    const ttl = ttlHours * 60 * 60 * 1000

    const sweep = () => {
        const t = now()
        for (const [id, s] of sessions) {
            if (s.expires <= t) {
                sessions.delete(id)
            }
        }
    }
    const timer = setInterval(sweep, 10 * 60 * 1000)
    timer.unref?.()

    return {
        create: (data) => {
            const id = randomBytes(32).toString('base64url')
            sessions.set(id, { ...data, id, expires: now() + ttl })
            return sessions.get(id)
        },
        /** Look a session up and slide its expiry forward. */
        get: (id) => {
            const s = id && sessions.get(id)
            if (!s) {
                return null
            }
            if (s.expires <= now()) {
                sessions.delete(id)
                return null
            }
            s.expires = now() + ttl
            return s
        },
        destroy: (id) => sessions.delete(id),
        size: () => sessions.size,
        stop: () => clearInterval(timer),
    }
}

/** Failed sign-ins per client, so a password cannot be guessed at speed. */
export const createLoginLimiter = ({ max = 10, windowMs = 15 * 60 * 1000 } = {}) => {
    const failures = new Map()
    const prune = (key) => {
        const cutoff = Date.now() - windowMs
        const list = (failures.get(key) || []).filter((t) => t > cutoff)
        if (list.length) {
            failures.set(key, list)
        } else {
            failures.delete(key)
        }
        return list
    }
    return {
        blocked: (key) => prune(key).length >= max,
        fail: (key) => failures.set(key, [...prune(key), Date.now()]),
        reset: (key) => failures.delete(key),
    }
}
