import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertConfig, loadConfig, normalizeUrl } from './config.js'
import { Dhis2AuthError, createDhis2Client, looksLikeToken } from './dhis2.js'

const respond = (status, body, type = 'application/json') => async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': type },
    })

const conn = { baseUrl: 'https://dhims.example/dhims', token: 'd2pat_abcdefghijklmnop1234' }

describe('DHIS2 client', () => {
    it('authenticates with the ApiToken scheme, not Bearer', async () => {
        let seen
        const client = createDhis2Client({
            fetchImpl: async (url, init) => {
                seen = { url, init }
                return respond(200, { id: 'u1', username: 'a' })()
            },
        })
        const me = await client.verify(conn)
        assert.equal(me.username, 'a')
        assert.match(seen.url, /^https:\/\/dhims\.example\/dhims\/api\/me\?fields=/)
        assert.equal(seen.init.headers.Authorization, `ApiToken ${conn.token}`)
    })

    it('uses Bearer only when the connection asks for it', async () => {
        let seen
        const client = createDhis2Client({
            fetchImpl: async (url, init) => {
                seen = init
                return respond(200, { id: 'u1' })()
            },
        })
        await client.verify({ ...conn, tokenType: 'Bearer' })
        assert.equal(seen.headers.Authorization, `Bearer ${conn.token}`)
        await client.verify({ ...conn, tokenType: 'anything else' })
        assert.equal(seen.headers.Authorization, `ApiToken ${conn.token}`)
    })

    it('reports a rejected token as an authentication error', async () => {
        const client = createDhis2Client({ fetchImpl: respond(401, { httpStatus: 'Unauthorized' }) })
        await assert.rejects(client.verify(conn), Dhis2AuthError)
    })

    it('says so when the URL is not a DHIS2 server', async () => {
        const client = createDhis2Client({ fetchImpl: respond(200, '<html>hello</html>', 'text/html') })
        await assert.rejects(client.verify(conn), /did not answer like a DHIS2 server/)
    })
})

describe('token and URL checks', () => {
    it('recognises DHIS2 personal access tokens', () => {
        assert.equal(looksLikeToken('d2pat_FakeTokenForFormatCheck00000000000000000'), true)
        assert.equal(looksLikeToken('d2p_abcdefghijklmnop1234'), true)
        assert.equal(looksLikeToken('district'), false)
        assert.equal(looksLikeToken('Bearer d2pat_abc'), false)
    })

    it('normalises DHIS2 URLs and rejects anything else', () => {
        assert.equal(normalizeUrl(' https://DHIMS.chimgh.org/dhims/ '), 'https://dhims.chimgh.org/dhims')
        assert.equal(normalizeUrl('ftp://x'), null)
        assert.equal(normalizeUrl('https://user:pw@host/dhims'), null)
        assert.equal(normalizeUrl('dhims.chimgh.org'), null)
    })
})

describe('DHIS2 settings inherited from DHIS2 Analysis', () => {
    it('pins sessions to DHIS2_BASE_URL when it is set', () => {
        const config = loadConfig({ DHIS2_BASE_URL: 'https://DHIMS.example/dhims/', DATABASE_URL: 'x' })
        assert.equal(config.dhis2Url, 'https://dhims.example/dhims')
        assert.deepEqual(config.allowedDhis2Urls, ['https://dhims.example/dhims'])
        assert.equal(config.allowAnyDhis2Url, false)
    })

    it("follows each viewer's connection when no server is pinned", () => {
        const config = loadConfig({ DATABASE_URL: 'x' })
        assert.equal(config.dhis2Url, '')
        assert.equal(config.allowAnyDhis2Url, true)
        assert.doesNotThrow(() => assertConfig(config))
    })

    it('ignores the old standalone DHIS2_URL and DHIS2_ALLOWED_URLS', () => {
        const config = loadConfig({
            DHIS2_URL: 'https://other.example',
            DHIS2_ALLOWED_URLS: '*',
            DHIS2_BASE_URL: 'https://dhims.example/dhims',
        })
        assert.deepEqual(config.allowedDhis2Urls, ['https://dhims.example/dhims'])
        assert.equal(config.allowAnyDhis2Url, false)
    })
})
