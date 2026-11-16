import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import { normalizeTokenType, normalizeUrl } from './config.js'
import { Dhis2AuthError, authHeaders, looksLikeToken } from './dhis2.js'
import { buildUser } from './permissions.js'
import {
    authorizeAssessmentWrite,
    authorizeConfigWrite,
    authorizeDelete,
    parseAssessmentKey,
} from './rules.js'
import {
    SESSION_COOKIE,
    createLoginLimiter,
    createSessionStore,
    parseCookies,
} from './sessions.js'
import { ConflictError } from './store.js'

/**
 * The DHIS2 resources the browser may read through this server. The app reads
 * nothing else from DHIS2, so nothing else is passed through.
 */
const DHIS2_READABLE = new Set([
    'me',
    'organisationUnits',
    'analytics',
    'indicators',
    'dataElements',
    'users',
    'system',
])

const KEY_PATTERN = /^[A-Za-z0-9._-]{1,200}$/

const sendError = (res, status, message, extra = {}) =>
    res.status(status).json({ httpStatusCode: status, message, ...extra })

const userLabel = (user) =>
    user.displayName && user.username
        ? `${user.displayName} (${user.username})`
        : user.username || user.id

/**
 * Build the Express app. Dependencies are passed in so the tests can run it
 * against an in-memory store and a fake DHIS2.
 */
export const createApp = ({ config, store, dhis2, sessions, logger = console }) => {
    const app = express()
    const sessionStore = sessions || createSessionStore({ ttlHours: config.sessionTtlHours })
    const limiter = createLoginLimiter()

    app.disable('x-powered-by')
    if (config.trustProxy) {
        app.set('trust proxy', 1)
    }
    app.use((req, res, next) => {
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'same-origin',
            'X-Frame-Options': 'SAMEORIGIN',
        })
        next()
    })

    const cookieOptions = {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.secureCookies,
        path: '/',
    }

    const sessionOf = (req) =>
        sessionStore.get(parseCookies(req.headers.cookie)[SESSION_COOKIE])

    const requireSession = (req, res, next) => {
        const session = sessionOf(req)
        if (!session) {
            return sendError(res, 401, 'Not signed in.')
        }
        req.session = session
        next()
    }

    /** Writes must be JSON, which a cross-site form cannot send. */
    const requireJson = (req, res, next) =>
        req.is('application/json')
            ? next()
            : sendError(res, 415, 'Send the request body as application/json.')

    const endSession = (req, res) => {
        if (req.session) {
            sessionStore.destroy(req.session.id)
        }
        res.clearCookie(SESSION_COOKIE, cookieOptions)
    }

    /* ---------------------------------------------------------------- health */

    app.get('/healthz', async (req, res) => {
        try {
            await store.ping()
            res.json({ ok: true, store: store.kind })
        } catch (e) {
            res.status(503).json({ ok: false, error: e.message })
        }
    })

    /* ------------------------------------------------------------------ auth */

    const isAllowedUrl = (url) =>
        config.allowAnyDhis2Url || config.allowedDhis2Urls.includes(url)

    /** What the sign-in page needs before anyone has signed in. */
    app.get('/auth/config', (req, res) => {
        res.json({
            defaultUrl: config.dhis2Url,
            allowedUrls: config.allowedDhis2Urls,
            allowAnyUrl: config.allowAnyDhis2Url,
        })
    })

    /*
     * Sign in with a DHIS2 URL and token. In DHIS2 Analysis only the parent
     * app calls this, server to server, with the viewer's existing DHIS2
     * connection (its /holistic/auth/connect route); the browser cannot reach
     * it. The token is checked by asking DHIS2 whose it is, then held in this
     * process for the session; it is never written to disk or sent back.
     */
    app.post('/auth/login', express.json({ limit: '10kb' }), requireJson, async (req, res) => {
        const baseUrl = normalizeUrl(req.body?.url)
        const token = String(req.body?.token || '').trim()
        const tokenType = normalizeTokenType(req.body?.tokenType)
        if (!baseUrl) {
            return sendError(res, 400, 'Enter the DHIMS address, starting with https://')
        }
        if (!isAllowedUrl(baseUrl)) {
            return sendError(
                res,
                400,
                `Holistic Assessment is set up for ${config.allowedDhis2Urls.join(' or ')} (DHIS2_BASE_URL), but this connection is to ${baseUrl}.`
            )
        }
        if (tokenType === 'ApiToken' ? !looksLikeToken(token) : !token) {
            return sendError(
                res,
                400,
                'That does not look like a DHIS2 personal access token. Tokens start with d2pat_ (or d2p_).'
            )
        }
        const limitKey = req.ip
        if (limiter.blocked(limitKey)) {
            return sendError(res, 429, 'Too many failed attempts. Wait a few minutes and try again.')
        }
        const conn = { baseUrl, token, tokenType }
        try {
            const me = await dhis2.verify(conn)
            const user = buildUser(me, config)
            if (
                config.requirePermission &&
                !user.canEdit &&
                !user.canReview &&
                !user.canAdmin
            ) {
                return sendError(res, 403, 'Your DHIS2 account has not been given access to this app.')
            }
            limiter.reset(limitKey)
            const session = sessionStore.create({ user, conn })
            res.cookie(SESSION_COOKIE, session.id, {
                ...cookieOptions,
                maxAge: config.sessionTtlHours * 60 * 60 * 1000,
            })
            logger.info?.(`sign-in ${user.username} via ${baseUrl}`)
            res.json({ user, dhis2Url: baseUrl, apiVersion: config.dhis2ApiVersion })
        } catch (e) {
            if (e instanceof Dhis2AuthError) {
                limiter.fail(limitKey)
                return sendError(res, e.status, e.message)
            }
            logger.error(`sign-in failed: ${e.message}`)
            return sendError(res, 502, e.message)
        }
    })

    app.post('/auth/logout', (req, res) => {
        req.session = sessionOf(req)
        endSession(req, res)
        res.json({ ok: true })
    })

    app.get('/auth/session', requireSession, (req, res) => {
        res.json({
            user: req.session.user,
            dhis2Url: req.session.conn.baseUrl,
            apiVersion: config.dhis2ApiVersion,
        })
    })

    /* ---------------------------------------------------------- DHIS2 proxy */

    /*
     * The browser's DHIS2 data engine is pointed at /dhis2, so its requests
     * arrive here as /dhis2/api/<version>/<resource> and are replayed against
     * DHIS2 with the user's own DHIS2 session. Read-only: the app never writes
     * to DHIS2, so neither may anything sent through this route.
     */
    app.use('/dhis2/api', requireSession, async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return sendError(res, 405, 'DHIS2 is read-only through this app.')
        }
        const parts = req.path.split('/').filter(Boolean)
        const resource = /^\d+$/.test(parts[0] || '') ? parts[1] : parts[0]
        if (!DHIS2_READABLE.has(resource)) {
            return sendError(res, 403, `DHIS2 resource "${resource}" is not available through this app.`)
        }
        const query = req.originalUrl.includes('?')
            ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
            : ''
        const target = `${req.session.conn.baseUrl}/api${req.path}${query}`
        try {
            const upstream = await dhis2.fetch(target, {
                method: req.method,
                headers: {
                    Accept: req.headers.accept || 'application/json',
                    ...authHeaders(req.session.conn),
                },
                redirect: 'manual',
            })
            if (
                upstream.status === 401 ||
                (upstream.status >= 300 && upstream.status < 400)
            ) {
                endSession(req, res)
                return sendError(res, 401, 'DHIS2 no longer accepts your token. Sign in again.')
            }
            res.status(upstream.status)
            const type = upstream.headers.get('content-type')
            if (type) {
                res.set('Content-Type', type)
            }
            res.send(Buffer.from(await upstream.arrayBuffer()))
        } catch (e) {
            logger.error(`DHIS2 proxy ${req.path}: ${e.message}`)
            sendError(res, 502, `Could not reach DHIS2: ${e.message}`)
        }
    })

    /* ------------------------------------------------------------ the store */

    const versionHeader = (req, name) => {
        const raw = req.headers[name]
        if (!raw) {
            return undefined
        }
        if (raw.trim() === '*') {
            return '*'
        }
        const n = Number(raw.replace(/^W\//, '').replace(/"/g, ''))
        return Number.isInteger(n) && n > 0 ? n : NaN
    }

    const checkKey = (req, res, next) =>
        KEY_PATTERN.test(req.params.key)
            ? next()
            : sendError(res, 400, 'Invalid key.')

    app.get('/api/store', requireSession, async (req, res, next) => {
        try {
            res.json(await store.list())
        } catch (e) {
            next(e)
        }
    })

    app.get('/api/store/:key', requireSession, checkKey, async (req, res, next) => {
        try {
            const entry = await store.get(req.params.key)
            if (!entry) {
                return sendError(res, 404, 'Key not found.')
            }
            res.set('ETag', `"${entry.version}"`)
            res.set('Cache-Control', 'no-store')
            res.json(entry.value)
        } catch (e) {
            next(e)
        }
    })

    app.put(
        '/api/store/:key',
        requireSession,
        checkKey,
        express.json({ limit: '5mb' }),
        requireJson,
        async (req, res, next) => {
            const { key } = req.params
            const { user, conn } = req.session
            try {
                const ifMatch = versionHeader(req, 'if-match')
                const ifNoneMatch = versionHeader(req, 'if-none-match')
                if (Number.isNaN(ifMatch)) {
                    return sendError(res, 400, 'If-Match must be a version number.')
                }

                const before = await store.get(key)
                const conflict =
                    (ifNoneMatch === '*' && before) ||
                    (typeof ifMatch === 'number' && before?.version !== ifMatch) ||
                    (ifMatch === '*' && !before)
                if (conflict) {
                    return sendError(res, 409, 'This record was changed by someone else since it was loaded. Reload to see the latest version.', {
                        version: before?.version ?? null,
                    })
                }

                let denial
                const parsed = parseAssessmentKey(key)
                if (parsed) {
                    let orgUnit
                    try {
                        orgUnit = await dhis2.orgUnitPath(conn, parsed.orgUnitId)
                    } catch (e) {
                        if (e instanceof Dhis2AuthError) {
                            endSession(req, res)
                            return sendError(res, 401, 'DHIS2 no longer accepts your token. Sign in again.')
                        }
                        return sendError(res, 403, 'That org unit is not visible to you in DHIS2.')
                    }
                    const [periods, pairings] = await Promise.all([
                        store.get('periods'),
                        store.get('peer-pairings'),
                    ])
                    denial = authorizeAssessmentWrite({
                        user,
                        key,
                        before: before?.value ?? null,
                        after: req.body,
                        orgUnit,
                        periods: periods?.value,
                        pairings: pairings?.value,
                    })
                } else {
                    denial = authorizeConfigWrite(user, key)
                }
                if (denial) {
                    return sendError(res, denial.status, denial.message)
                }

                // Write against exactly the version the rules were checked on.
                const entry = await store.put(key, req.body, {
                    expectedVersion: before ? before.version : 0,
                    user: userLabel(user),
                })
                res.set('ETag', `"${entry.version}"`)
                res.json({ key, version: entry.version })
            } catch (e) {
                if (e instanceof ConflictError) {
                    return sendError(res, 409, e.message, {
                        version: e.current?.version ?? null,
                    })
                }
                next(e)
            }
        }
    )

    app.delete('/api/store/:key', requireSession, checkKey, async (req, res, next) => {
        const denial = authorizeDelete(req.session.user)
        if (denial) {
            return sendError(res, denial.status, denial.message)
        }
        try {
            const removed = await store.remove(req.params.key, {
                user: userLabel(req.session.user),
            })
            return removed
                ? res.json({ ok: true })
                : sendError(res, 404, 'Key not found.')
        } catch (e) {
            next(e)
        }
    })

    app.use(['/api', '/auth', '/dhis2'], (req, res) =>
        sendError(res, 404, 'Not found.')
    )

    /* ------------------------------------------------------------- frontend */

    const staticDir = path.resolve(config.staticDir)
    if (existsSync(staticDir)) {
        app.use(
            express.static(staticDir, {
                index: 'index.html',
                setHeaders: (res, file) => {
                    // Hashed bundles never change; the page itself always might.
                    res.set(
                        'Cache-Control',
                        file.endsWith('.html')
                            ? 'no-cache'
                            : 'public, max-age=31536000, immutable'
                    )
                },
            })
        )
        app.get('/{*splat}', (req, res) =>
            res.sendFile(path.join(staticDir, 'index.html'))
        )
    }

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            return sendError(res, 400, 'The request body is not valid JSON.')
        }
        if (err.type === 'entity.too.large') {
            return sendError(res, 413, 'The record is too large.')
        }
        logger.error(err)
        sendError(res, 500, 'Something went wrong on the server.')
    })

    return app
}
