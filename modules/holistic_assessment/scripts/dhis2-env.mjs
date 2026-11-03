/**
 * Where the command-line scripts find their DHIS2 servers.
 *
 * DHIMS (the "SOURCE" side of the copy scripts, and the only server the other
 * scripts talk to) is the server DHIS2 Analysis is configured for, read from
 * the same variables the parent app uses — see the repository's .env.example:
 *
 *     DHIS2_BASE_URL   DHIS2_TOKEN   DHIS2_TOKEN_TYPE (ApiToken | Bearer)
 *
 * The copy scripts also write to a second, different DHIS2 instance (a local
 * or test server). That one is not DHIMS and has no equivalent in DHIS2
 * Analysis, so it keeps its own TARGET_URL with TARGET_TOKEN, or
 * TARGET_USERNAME and TARGET_PASSWORD.
 *
 * Credentials are read from the environment and never printed or written.
 */

const fail = (message) => {
    console.error(message)
    process.exit(2)
}

const scheme = (type) => (type === 'Bearer' ? 'Bearer' : 'ApiToken')

/** `{ base, authorization }` for 'SOURCE' (DHIMS) or 'TARGET'. */
export const dhis2Server = (side = 'SOURCE') => {
    if (side === 'SOURCE') {
        const base = (process.env.DHIS2_BASE_URL || '').trim().replace(/\/+$/, '')
        const token = (process.env.DHIS2_TOKEN || '').trim()
        if (!base || !token) {
            fail(
                'Set DHIS2_BASE_URL and DHIS2_TOKEN (the DHIS2 Analysis settings in the ' +
                    'repository .env), e.g. run with: node --env-file=../../.env <script>'
            )
        }
        return {
            base,
            authorization: `${scheme(process.env.DHIS2_TOKEN_TYPE)} ${token}`,
        }
    }

    const base = (process.env.TARGET_URL || '').trim().replace(/\/+$/, '')
    if (!base) {
        fail('Set TARGET_URL.')
    }
    const token = process.env.TARGET_TOKEN
    if (token) {
        return { base, authorization: `ApiToken ${token}` }
    }
    const user = process.env.TARGET_USERNAME
    const pass = process.env.TARGET_PASSWORD
    if (user && pass) {
        return {
            base,
            authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
        }
    }
    return fail('Set TARGET_URL and either TARGET_TOKEN, or TARGET_USERNAME and TARGET_PASSWORD.')
}
