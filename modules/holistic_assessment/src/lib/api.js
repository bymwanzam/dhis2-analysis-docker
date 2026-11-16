/**
 * Requests to this app's own server: sign-in, the session and the store.
 *
 * Any 401 — from these or from the DHIS2 proxy the data engine talks to —
 * means the session is gone, and is broadcast so the shell can return the user
 * to the sign-in page instead of leaving them on a screen full of errors.
 */

export const SESSION_EXPIRED_EVENT = 'ghsha:session-expired'

export class ApiError extends Error {
    constructor(status, message, body = {}) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.body = body
        // The shape @dhis2/app-runtime errors have, which existing checks read.
        this.details = { httpStatusCode: status, ...body }
    }
}

/*
 * The module is served by DHIS2 Analysis under /holistic/ (Vite's `base`), so
 * every call to this module's own server — sign-in, the store and the DHIS2
 * proxy — is made under that prefix. `appPath('/auth/session')` is
 * '/holistic/auth/session'.
 */
export const BASE_PATH = (import.meta.env?.BASE_URL || '/').replace(/\/+$/, '')
export const appPath = (path) => (path.startsWith('/') ? `${BASE_PATH}${path}` : path)

export const apiFetch = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(appPath(path), {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data = null
    try {
        data = text ? JSON.parse(text) : null
    } catch {
        data = { message: text }
    }
    if (!res.ok) {
        throw new ApiError(
            res.status,
            data?.message || `Request failed (${res.status})`,
            data || {}
        )
    }
    return { data, res }
}

/**
 * Watch every same-origin response for a 401, so expiry is noticed whichever
 * part of the app made the request — including @dhis2/app-runtime's queries,
 * which do not go through `apiFetch`.
 */
export const installSessionWatcher = () => {
    if (window.__ghshaFetchWrapped) {
        return
    }
    window.__ghshaFetchWrapped = true
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
        const res = await original(input, init)
        const url = typeof input === 'string' ? input : input?.url || ''
        const sameOrigin =
            url.startsWith('/') || url.startsWith(window.location.origin)
        const isAuthCall = url.includes('/auth/')
        if (res.status === 401 && sameOrigin && !isAuthCall) {
            window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
        }
        return res
    }
}

export const getSession = async () => {
    try {
        const { data } = await apiFetch('/auth/session')
        return data
    } catch (e) {
        if (e.status === 401) {
            return null
        }
        throw e
    }
}

/**
 * Sign in with the viewer's DHIS2 Analysis connection. No URL or token is
 * sent from here: DHIS2 Analysis reads its own connection on the server and
 * signs in to this module with it. A 401 means the viewer has not connected
 * DHIS2 Analysis to DHIS2 yet.
 */
export const connect = async () =>
    (await apiFetch('/auth/connect', { method: 'POST', body: {} })).data

export const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST', body: {} }).catch(() => {})
}
