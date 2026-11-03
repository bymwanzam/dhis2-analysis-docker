/**
 * Move existing records into the app's Postgres store.
 *
 * Two sources:
 *   --file <backup.json>   a backup made on the Administration page's Data tab
 *   --from-dhis2           read the `ghs-holistic-assessment` datastore namespace
 *                          straight from DHIS2, using the DHIS2 Analysis
 *                          settings: DHIS2_BASE_URL, DHIS2_TOKEN and
 *                          DHIS2_TOKEN_TYPE
 *
 * Keys that already exist in Postgres are left alone unless --overwrite is
 * given. --dry-run reports what would happen and writes nothing.
 *
 *   DATABASE_URL=postgres://... node server/scripts/import-store.js --file backup.json --dry-run
 */
import { readFileSync } from 'node:fs'
import { createPgStore } from '../store.js'

const NAMESPACE = 'ghs-holistic-assessment'
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
}

const file = option('file')
const fromDhis2 = flag('from-dhis2')
const dryRun = flag('dry-run')
const overwrite = flag('overwrite')

if (Boolean(file) === fromDhis2) {
    console.error(
        'Usage: node server/scripts/import-store.js (--file <backup.json> | --from-dhis2) [--overwrite] [--dry-run] [--insecure]'
    )
    process.exit(2)
}
if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL.')
    process.exit(2)
}
if (flag('insecure')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const fromFile = () => {
    const payload = JSON.parse(readFileSync(file, 'utf8'))
    if (!payload?.data || typeof payload.data !== 'object') {
        throw new Error(`${file} is not a backup from the Data tab (no "data" object).`)
    }
    if (payload.namespace && payload.namespace !== NAMESPACE) {
        console.warn(`Backup is of namespace "${payload.namespace}", not "${NAMESPACE}".`)
    }
    return payload.data
}

const fromDhis2Namespace = async () => {
    const base = (process.env.DHIS2_BASE_URL || '').trim().replace(/\/+$/, '')
    const token = (process.env.DHIS2_TOKEN || '').trim()
    if (!base || !token) {
        throw new Error('Set DHIS2_BASE_URL and DHIS2_TOKEN (the DHIS2 Analysis settings).')
    }
    const headers = {
        Accept: 'application/json',
        // ApiToken for a DHIS2 personal access token, unless DHIS2_TOKEN_TYPE says Bearer.
        Authorization: `${process.env.DHIS2_TOKEN_TYPE === 'Bearer' ? 'Bearer' : 'ApiToken'} ${token}`,
    }
    const get = async (path) => {
        const res = await fetch(`${base}/api/dataStore/${NAMESPACE}${path}`, {
            headers,
            redirect: 'manual',
        })
        if (!res.ok) {
            throw new Error(`DHIS2 answered ${res.status} for dataStore/${NAMESPACE}${path}`)
        }
        return res.json()
    }
    const keys = await get('')
    const data = {}
    for (const key of keys) {
        data[key] = await get(`/${encodeURIComponent(key)}`)
    }
    return data
}

const data = file ? fromFile() : await fromDhis2Namespace()
const store = await createPgStore({ databaseUrl: process.env.DATABASE_URL })
const counts = { created: 0, overwritten: 0, skipped: 0 }

try {
    for (const [key, value] of Object.entries(data)) {
        const existing = await store.get(key)
        if (existing && !overwrite) {
            counts.skipped++
            console.info(`skip       ${key} (already in Postgres, version ${existing.version})`)
            continue
        }
        console.info(`${existing ? 'overwrite' : 'create   '}  ${key}`)
        if (!dryRun) {
            await store.put(key, value, { user: 'import-store' })
        }
        counts[existing ? 'overwritten' : 'created']++
    }
} finally {
    await store.close()
}

console.info(
    `${dryRun ? '[dry run] ' : ''}${counts.created} created, ${counts.overwritten} overwritten, ${counts.skipped} skipped`
)
