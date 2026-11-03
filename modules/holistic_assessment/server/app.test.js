import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { Dhis2AuthError } from './dhis2.js'
import { createMemoryStore } from './store.js'

/** A stand-in for DHIS2: two users, one region each. */
const PROFILES = {
    owner: {
        id: 'uOwner00000',
        username: 'owner',
        displayName: 'Owner',
        authorities: ['GHS_ASSESSMENT_EDIT'],
        organisationUnits: [{ id: 'R1aaaaaaaaa', level: 2, path: '/GHaaaaaaaaa/R1aaaaaaaaa' }],
        userGroups: [],
    },
    other: {
        id: 'uOther00000',
        username: 'other',
        displayName: 'Other',
        authorities: ['GHS_ASSESSMENT_EDIT'],
        organisationUnits: [{ id: 'R2aaaaaaaaa', level: 2, path: '/GHaaaaaaaaa/R2aaaaaaaaa' }],
        userGroups: [{ id: 'g1', name: 'GHS HA Reviewers' }],
    },
}

const TOKENS = {
    d2pat_ownerToken0000000000000001: 'owner',
    d2pat_otherToken0000000000000002: 'other',
}
const DHIS2 = 'https://dhis2.example/dhims'

const fakeDhis2 = () => {
    const proxied = []
    const profileFor = (conn) => {
        const who = conn.baseUrl === DHIS2 && TOKENS[conn.token]
        if (!who) {
            throw new Dhis2AuthError('DHIS2 did not accept this token.')
        }
        return PROFILES[who]
    }
    return {
        proxied,
        verify: async (conn) => profileFor(conn),
        orgUnitPath: async (conn, id) => ({ id, level: 2, path: `/GHaaaaaaaaa/${id}` }),
        fetch: async (url, init) => {
            proxied.push({ url, init })
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        },
    }
}

let server
let base
let dhis2

before(async () => {
    dhis2 = fakeDhis2()
    const config = {
        ...loadConfig({ DHIS2_BASE_URL: `${DHIS2}/` }),
        staticDir: 'does-not-exist',
    }
    const app = createApp({
        config,
        store: createMemoryStore(),
        dhis2,
        logger: { info() {}, error() {} },
    })
    await new Promise((resolve) => {
        server = app.listen(0, resolve)
    })
    base = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

const call = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: {
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    return { status: res.status, res, body: text ? JSON.parse(text) : null }
}

const tokenOf = (username) =>
    Object.keys(TOKENS).find((t) => TOKENS[t] === username)

const signIn = async (username) => {
    const { status, res, body } = await call('/auth/login', {
        method: 'POST',
        body: { url: DHIS2, token: tokenOf(username) },
    })
    assert.equal(status, 200, body?.message)
    const cookie = res.headers.get('set-cookie').split(';')[0]
    return { cookie, user: body.user }
}

const KEY = 'assessment-2025-R1aaaaaaaaa'
const record = (extra = {}) => ({
    frameworkId: 'ghs-ha-2025',
    year: 2025,
    level: 'REGION',
    orgUnit: { id: 'R1aaaaaaaaa', name: 'Region 1' },
    status: 'DRAFT',
    values: {},
    milestones: {},
    review: null,
    history: [],
    ...extra,
})

describe('sign-in', () => {
    it('refuses everything without a session', async () => {
        assert.equal((await call('/api/store')).status, 401)
        assert.equal((await call('/auth/session')).status, 401)
        assert.equal((await call('/dhis2/api/41/me')).status, 401)
    })

    it('offers the configured DHIMS URL before sign-in', async () => {
        const r = await call('/auth/config')
        assert.equal(r.status, 200)
        assert.equal(r.body.defaultUrl, DHIS2)
        assert.deepEqual(r.body.allowedUrls, [DHIS2])
    })

    it('refuses a token DHIS2 does not accept', async () => {
        const r = await call('/auth/login', {
            method: 'POST',
            body: { url: DHIS2, token: 'd2pat_wrongToken00000000000000' },
        })
        assert.equal(r.status, 401)
    })

    it('refuses something that is not a token, without asking DHIS2', async () => {
        const r = await call('/auth/login', {
            method: 'POST',
            body: { url: DHIS2, token: 'my password' },
        })
        assert.equal(r.status, 400)
        assert.match(r.body.message, /personal access token/)
    })

    it('refuses a DHIS2 URL that is not on the allowed list', async () => {
        for (const url of ['https://evil.example/dhims', 'http://127.0.0.1:5432', 'file:///etc/passwd', 'not a url']) {
            const r = await call('/auth/login', {
                method: 'POST',
                body: { url, token: tokenOf('owner') },
            })
            assert.equal(r.status, 400, url)
        }
    })

    it('accepts the allowed URL however it is typed', async () => {
        const r = await call('/auth/login', {
            method: 'POST',
            body: { url: '  HTTPS://DHIS2.example/dhims/ ', token: tokenOf('owner') },
        })
        assert.equal(r.status, 200, r.body?.message)
    })

    it('signs in, keeps the token off the browser, and signs out', async () => {
        const { cookie, user } = await signIn('owner')
        assert.match(cookie, /^ghsha_sid=/)
        assert.equal(user.username, 'owner')
        assert.equal(user.canEdit, true)
        const session = await call('/auth/session', { cookie })
        assert.equal(JSON.stringify(session.body).includes('d2pat_'), false)
        assert.equal(session.body.dhis2Url, DHIS2)

        assert.equal((await call('/auth/session', { cookie })).status, 200)
        await call('/auth/logout', { method: 'POST', body: {}, cookie })
        assert.equal((await call('/auth/session', { cookie })).status, 401)
    })

    it('uses the Bearer scheme when the DHIS2 Analysis connection says so', async () => {
        const r = await call('/auth/login', {
            method: 'POST',
            body: { url: DHIS2, token: tokenOf('owner'), tokenType: 'Bearer' },
        })
        assert.equal(r.status, 200, r.body?.message)
        const cookie = r.res.headers.get('set-cookie').split(';')[0]
        await call('/dhis2/api/41/me', { cookie })
        assert.equal(dhis2.proxied.at(-1).init.headers.Authorization, `Bearer ${tokenOf('owner')}`)
    })

    it('adds group-granted permissions to the authorities the browser sees', async () => {
        const { user } = await signIn('other')
        assert.ok(user.authorities.includes('GHS_PEER_REVIEW'))
        assert.equal(user.canReview, true)
    })
})

describe('DHIS2 proxy', () => {
    it('forwards reads with the user’s own token', async () => {
        const { cookie } = await signIn('owner')
        const r = await call('/dhis2/api/41/organisationUnits?fields=id&paging=false', { cookie })
        assert.equal(r.status, 200)
        const last = dhis2.proxied.at(-1)
        assert.equal(last.url, `${DHIS2}/api/41/organisationUnits?fields=id&paging=false`)
        assert.equal(last.init.headers.Authorization, `ApiToken ${tokenOf('owner')}`)
    })

    it('is read-only and limited to what the app uses', async () => {
        const { cookie } = await signIn('owner')
        assert.equal((await call('/dhis2/api/41/me', { method: 'POST', body: {}, cookie })).status, 405)
        assert.equal((await call('/dhis2/api/41/dataStore/other', { cookie })).status, 403)
    })
})

describe('store', () => {
    it('creates, versions and refuses stale writes', async () => {
        const { cookie } = await signIn('owner')
        const created = await call(`/api/store/${KEY}`, {
            method: 'PUT',
            body: record(),
            cookie,
            headers: { 'If-None-Match': '*' },
        })
        assert.equal(created.status, 200, created.body?.message)
        assert.equal(created.body.version, 1)

        const read = await call(`/api/store/${KEY}`, { cookie })
        assert.equal(read.res.headers.get('etag'), '"1"')

        const edit = record({ values: { 1.1: { current: 4 } } })
        const ok = await call(`/api/store/${KEY}`, { method: 'PUT', body: edit, cookie, headers: { 'If-Match': '"1"' } })
        assert.equal(ok.status, 200, ok.body?.message)
        assert.equal(ok.body.version, 2)

        // A second editor still holding version 1 is refused, not merged over.
        const stale = await call(`/api/store/${KEY}`, { method: 'PUT', body: record(), cookie, headers: { 'If-Match': '"1"' } })
        assert.equal(stale.status, 409)
        assert.equal(stale.body.version, 2)

        const keys = await call('/api/store', { cookie })
        assert.deepEqual(keys.body, [KEY])
    })

    it('refuses edits from another region', async () => {
        const { cookie } = await signIn('other')
        const r = await call(`/api/store/${KEY}`, {
            method: 'PUT',
            body: record({ values: { 1.1: { current: 99 } } }),
            cookie,
        })
        assert.equal(r.status, 403)
        assert.match(r.body.message, /Only the region or district/)
    })

    it('refuses settings changes from a non-admin', async () => {
        const { cookie } = await signIn('owner')
        const r = await call('/api/store/settings', { method: 'PUT', body: { defaultYear: 2025 }, cookie })
        assert.equal(r.status, 403)
    })

    it('rejects non-JSON writes and bad keys', async () => {
        const { cookie } = await signIn('owner')
        const r = await fetch(`${base}/api/store/settings`, {
            method: 'PUT',
            headers: { Cookie: cookie, 'Content-Type': 'text/plain' },
            body: '{}',
        })
        assert.equal(r.status, 415)
        assert.equal((await call('/api/store/bad%20key', { cookie })).status, 400)
    })
})
