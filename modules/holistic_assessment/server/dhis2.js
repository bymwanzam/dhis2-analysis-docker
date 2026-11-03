/**
 * Talking to DHIS2 on a user's behalf, with their personal access token.
 *
 * The user signs in with the DHIMS URL and a DHIS2 personal access token
 * (PAT). The server checks the token against DHIS2, keeps it in its own memory
 * for the session, and never sends it back to the browser. Every later DHIS2
 * request is made with that token, so DHIS2's own sharing and org unit
 * restrictions still decide what the user can see.
 *
 * A connection is `{ baseUrl, token }`; every call takes one, so the client
 * itself holds no credentials.
 */

export class Dhis2AuthError extends Error {
    constructor(message, status = 401) {
        super(message)
        this.name = 'Dhis2AuthError'
        this.status = status
    }
}

const ME_FIELDS = [
    'id',
    'username',
    'displayName',
    'authorities',
    'organisationUnits[id,displayName,level,path,parent[id,displayName]]',
    'dataViewOrganisationUnits[id,displayName,level,path]',
    'userGroups[id,name,code]',
].join(',')

/**
 * DHIS2 personal access tokens use their own scheme, `ApiToken`. A connection
 * from DHIS2 Analysis may say `Bearer` instead (DHIS2_TOKEN_TYPE), so the
 * scheme travels with the token.
 */
export const authHeaders = (conn) =>
    conn?.token
        ? { Authorization: `${conn.tokenType === 'Bearer' ? 'Bearer' : 'ApiToken'} ${conn.token}` }
        : {}

/**
 * DHIS2 personal access tokens start `d2pat_` (or `d2p_` on some versions),
 * followed by letters and digits. Checked before DHIS2 is asked, so an obvious
 * paste mistake gets a clear message.
 */
export const looksLikeToken = (token) => /^d2p(at)?_[A-Za-z0-9]{16,}$/.test(token)

export const createDhis2Client = ({ fetchImpl = fetch } = {}) => {
    const getJson = async (conn, path) => {
        let res
        try {
            res = await fetchImpl(`${conn.baseUrl}${path}`, {
                headers: { Accept: 'application/json', ...authHeaders(conn) },
                redirect: 'manual',
            })
        } catch (e) {
            throw new Error(`Could not reach DHIS2 at ${conn.baseUrl}: ${e.message}`)
        }
        // A rejected token answers 401; some setups redirect to a login page.
        if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
            throw new Dhis2AuthError(
                'DHIS2 did not accept this token. Check that it is correct, has not expired, and allows requests from this server.'
            )
        }
        if (!res.ok) {
            throw new Error(`DHIS2 ${path} answered ${res.status}`)
        }
        const type = res.headers.get('content-type') || ''
        if (!type.includes('json')) {
            throw new Error(
                `${conn.baseUrl} did not answer like a DHIS2 server. Check the URL.`
            )
        }
        return res.json()
    }

    /** Check a token by asking DHIS2 who it belongs to. */
    const verify = (conn) => getJson(conn, `/api/me?fields=${ME_FIELDS}`)

    /** Org unit paths change rarely; cache them so every save is not a round trip. */
    const pathCache = new Map()
    const orgUnitPath = async (conn, id) => {
        const cacheKey = `${conn.baseUrl}|${id}`
        const hit = pathCache.get(cacheKey)
        if (hit && hit.expires > Date.now()) {
            return hit.value
        }
        const ou = await getJson(
            conn,
            `/api/organisationUnits/${encodeURIComponent(id)}?fields=id,level,path`
        )
        const value = { id: ou.id, level: ou.level, path: ou.path }
        pathCache.set(cacheKey, { value, expires: Date.now() + 60 * 60 * 1000 })
        return value
    }

    return { verify, orgUnitPath, fetch: fetchImpl }
}
