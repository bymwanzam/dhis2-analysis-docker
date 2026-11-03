/**
 * Check the DHIS2 indicator ids the app ships against a live instance.
 *
 * `src/framework/indicator-ids.js` binds assessment rows to indicators on the
 * GHS instance by UID. UIDs are stable, but indicators do get renamed, retired
 * or rebuilt, so this script asks an instance which of them still exist and
 * whether any has drifted far enough from the framework's wording to be worth a
 * second look.
 *
 *     npm run verify:indicators
 *
 * It uses the DHIS2 Analysis settings in the repository .env (DHIS2_BASE_URL,
 * DHIS2_TOKEN, DHIS2_TOKEN_TYPE), via scripts/dhis2-env.mjs.
 *
 * The token is read from the environment and never written anywhere. Pass
 * `--insecure` for an instance with a self-signed certificate.
 *
 * Exits non-zero if any shipped id is missing from the instance, so it can gate
 * a release.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { dhis2Server } from './dhis2-env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const insecure = process.argv.includes('--insecure')
const { base, authorization } = dhis2Server('SOURCE')

if (insecure) {
    // Only for a local instance with a self-signed certificate.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const get = async (path) => {
    const res = await fetch(`${base}${path}`, {
        headers: {
            // ApiToken for a personal access token, unless DHIS2_TOKEN_TYPE
            // says Bearer; the wrong scheme falls through to the login redirect.
            Authorization: authorization,
            Accept: 'application/json',
        },
        redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) {
        throw new Error(
            `${res.status} redirect to ${res.headers.get('location')} — the ` +
                'token was not accepted, so the request fell through to the login page.'
        )
    }
    const body = await res.text()
    if (!res.ok) {
        let message = body.slice(0, 300)
        try {
            message = JSON.parse(body).message || message
        } catch {
            // Not JSON; the raw body is the best message available.
        }
        throw new Error(`${res.status} on ${path}: ${message}`)
    }
    return JSON.parse(body)
}

/** DHIS2 caps URL length, so ids go up to the instance in batches. */
const chunk = (items, size) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
        items.slice(i * size, i * size + size)
    )

const frameworks = {
    'ghs-ha-2025': 'framework-2025.json',
    'ghs-ha-2025-district': 'framework-2025-district.json',
}

const run = async () => {
    const { builtinIdsFor } = await import('../src/framework/indicator-ids.js')

    const me = await get('/api/me?fields=id,username,displayName')
    console.log(`Connected to ${base} as ${me.username}\n`)

    let missingTotal = 0

    for (const [frameworkId, file] of Object.entries(frameworks)) {
        const framework = JSON.parse(
            readFileSync(join(ROOT, 'src/framework', file), 'utf8')
        )
        const names = new Map(
            framework.objectives.flatMap((o) =>
                o.indicators.map((i) => [i.code, i.name])
            )
        )

        const shipped = builtinIdsFor(frameworkId)
        const ids = [...new Set(Object.values(shipped).map((e) => e.id))]

        const live = new Map()
        for (const batch of chunk(ids, 40)) {
            const page = await get(
                `/api/indicators?filter=id:in:[${batch.join(
                    ','
                )}]&fields=id,displayName&paging=false`
            )
            ;(page.indicators || []).forEach((i) =>
                live.set(i.id, i.displayName)
            )
        }

        const missing = Object.entries(shipped).filter(
            ([, entry]) => !live.has(entry.id)
        )
        missingTotal += missing.length

        console.log(
            `${frameworkId}: ${ids.length - missing.length}/${
                ids.length
            } shipped indicators found`
        )

        missing.forEach(([code, entry]) =>
            console.log(`  MISSING  ${code}  ${entry.id}  ${entry.name}`)
        )

        // A rename on the instance is not an error - the binding is by UID -
        // but a name that no longer resembles the framework row is worth a look.
        Object.entries(shipped).forEach(([code, entry]) => {
            const current = live.get(entry.id)
            if (current && current !== entry.name) {
                console.log(`  RENAMED  ${code}  ${entry.name}`)
                console.log(`        -> ${current}`)
                console.log(`     framework wording: ${names.get(code)}`)
            }
        })

        console.log()
    }

    if (missingTotal) {
        console.error(
            `${missingTotal} shipped indicator id(s) do not exist on this instance.`
        )
        process.exitCode = 1
        return
    }
    console.log('Every shipped indicator id resolves on this instance.')
}

// `process.exitCode` rather than `process.exit()`: exiting from inside a
// rejected promise tears down libuv mid-flight and trips an assertion on
// Windows.
run().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
})
