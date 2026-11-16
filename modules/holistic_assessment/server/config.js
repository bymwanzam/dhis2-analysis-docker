/**
 * Everything the server reads from its environment, in one place.
 *
 * The app keeps its own records (assessments, reviews, settings) in Postgres,
 * and borrows the rest from DHIS2: who the user is, their org units and
 * groups, the org unit hierarchy and analytics. `DHIS2_BASE_URL`, shared with
 * the parent DHIS2 Analysis app, is that instance.
 */

const list = (value) =>
    (value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

const bool = (value, fallback = false) =>
    value === undefined || value === ''
        ? fallback
        : /^(1|true|yes|on)$/i.test(value)

/**
 * A DHIS2 address in one canonical form, so "https://X/dhims/" and
 * "https://x/dhims" compare equal. Returns null for anything that is not a
 * plain http(s) URL.
 */
export const normalizeUrl = (value) => {
    try {
        const u = new URL(String(value || '').trim())
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
            return null
        }
        const path = u.pathname.replace(/\/+$/, '')
        return `${u.protocol}//${u.host.toLowerCase()}${path}`
    } catch {
        return null
    }
}

/** `ApiToken` (DHIS2 personal access token) unless the deployment says Bearer. */
export const normalizeTokenType = (value) =>
    value === 'Bearer' ? 'Bearer' : 'ApiToken'

/*
 * This module runs inside DHIS2 Analysis and uses that app's DHIS2 settings,
 * not its own: DHIS2_BASE_URL from the shared .env, and the connection that
 * src/lib/dhis2/connection.ts resolves (DHIS2_TOKEN / DHIS2_TOKEN_TYPE, or the
 * viewer's connection cookie). The token is never put in this container's
 * environment.
 *
 * Nobody types a URL or token into this module. The parent app's
 * /holistic/auth/connect route reads the viewer's DHIS2 Analysis connection
 * (the pinned environment credentials, or the viewer's own connection cookie)
 * and signs in here with it, server to server. /auth/login is not reachable
 * from the browser at all; see src/lib/holistic/paths.ts in the parent app.
 */
export const loadConfig = (env = process.env) => {
    const dhis2Url = normalizeUrl(env.DHIS2_BASE_URL) || ''
    const config = {
        port: Number(env.PORT || 3000),
        dhis2Url,
        /*
         * With DHIS2_BASE_URL set, that server is the only one a session may
         * use. Without it, DHIS2 Analysis lets each viewer connect to their
         * own server, and the parent app hands this module that connection.
         */
        allowAnyDhis2Url: !dhis2Url,
        allowedDhis2Urls: dhis2Url ? [dhis2Url] : [],
        // DHIS2 API version the browser's data engine asks for.
        dhis2ApiVersion: Number(env.DHIS2_API_VERSION || 41),
        dhis2Insecure: bool(env.DHIS2_INSECURE),
        databaseUrl: env.DATABASE_URL || '',
        sessionTtlHours: Number(env.SESSION_TTL_HOURS || 8),
        // Set when the app is served over HTTPS (directly or behind a proxy),
        // so the session cookie is only ever sent encrypted.
        secureCookies: bool(env.SECURE_COOKIES),
        trustProxy: bool(env.TRUST_PROXY),
        staticDir: env.STATIC_DIR || 'dist',

        /*
         * The GHS_* authorities were created in DHIS2 by installing the DHIS2
         * app. Outside DHIS2 they may not exist, so membership of a DHIS2 user
         * group can grant the same permission. Either source counts. Groups
         * are matched by name, code or id.
         */
        groups: {
            edit: list(env.EDIT_GROUPS ?? 'GHS HA Editors'),
            review: list(env.REVIEW_GROUPS ?? 'GHS HA Reviewers'),
            admin: list(env.ADMIN_GROUPS ?? 'GHS HA Admins'),
        },
        // When true, a DHIS2 user who holds none of the app's permissions is
        // turned away at login instead of getting a read-only view.
        requirePermission: bool(env.REQUIRE_APP_PERMISSION),
    }
    return config
}

export const assertConfig = (config) => {
    const missing = []
    if (!config.databaseUrl) {
        missing.push('DATABASE_URL')
    }
    if (missing.length) {
        throw new Error(
            `Missing required environment variable(s): ${missing.join(', ')}`
        )
    }
}
