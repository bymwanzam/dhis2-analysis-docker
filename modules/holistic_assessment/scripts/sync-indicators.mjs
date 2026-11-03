/**
 * Copy the DHIS2 indicators the app ships with from one instance to another,
 * keeping their UIDs.
 *
 * A DHIS2 app can only query the instance it is served from - `useDataEngine`
 * has no notion of a second server - so an app installed on a local instance
 * asks *that* instance for `U8DSAPaNJ8U` and the other ids in
 * `src/framework/indicator-ids.js`. If they live only on the GHS instance,
 * every one of those rows quietly falls back to manual entry.
 *
 * The indicators themselves are small: 53 of them and their 6 indicator types.
 * What they *reference* is not - the expressions reach ~197 data elements,
 * ~53 category option combos, 5 constants and ~116 data sets (indicator 1.41
 * sums reporting rates across every data set in the instance). Copying all of
 * that into another instance would be an enormous metadata change, and on a
 * Ghana instance it is almost certainly unnecessary: national data elements
 * and data sets are already there under the same UIDs.
 *
 * So the flow is probe first, import narrowly:
 *
 *     # 1. pull the indicators and note what they reference
 *     # DHIMS: DHIS2_BASE_URL and DHIS2_TOKEN from the repository .env
 *     node --env-file=../../.env scripts/sync-indicators.mjs export --out indicators.json
 *
 *     # 2. ask the target which of those references it is missing
 *     TARGET_URL=https://192.168.11.135/dhis TARGET_USERNAME=admin TARGET_PASSWORD=... \
 *       node scripts/sync-indicators.mjs probe --in indicators.json --insecure
 *
 *     # 3. if the probe is clean, import the indicators
 *     TARGET_URL=... TARGET_USERNAME=... TARGET_PASSWORD=... \
 *       node scripts/sync-indicators.mjs import --in indicators.json --dry-run --insecure
 *
 * If the probe reports missing references, re-run the export with
 * `--with-dependencies` to pull their definitions too, and look hard at the
 * result before importing - especially the data sets.
 *
 * Credentials are read from the environment, never written to the export.
 * `--insecure` is for an instance with a self-signed certificate.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dhis2Server } from './dhis2-env.mjs'

const args = process.argv.slice(2)
const mode = args[0]
const flag = (name) => args.includes(`--${name}`)
const value = (name) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
}

const MODES = ['export', 'probe', 'import']

if (!MODES.includes(mode)) {
    console.error(
        'Usage:\n' +
            '  node scripts/sync-indicators.mjs export --out <file> [--with-dependencies]\n' +
            '  node scripts/sync-indicators.mjs probe  --in <file> [--insecure]\n' +
            '  node scripts/sync-indicators.mjs import --in <file> [--dry-run] [--insecure]'
    )
    process.exit(2)
}

if (flag('insecure')) {
    // Only for an instance with a self-signed certificate.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const call = async (prefix, path, init = {}) => {
    const { base, authorization } = dhis2Server(prefix)
    const res = await fetch(`${base}${path}`, {
        ...init,
        headers: {
            Authorization: authorization,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
        redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) {
        throw new Error(
            `${res.status} redirect to ${res.headers.get('location')} — the ` +
                'credentials were not accepted, so the request fell through to the login page.'
        )
    }
    const text = await res.text()
    let body
    try {
        body = JSON.parse(text)
    } catch {
        body = text
    }
    if (!res.ok) {
        throw new Error(
            `${res.status} on ${path}: ${
                body?.message || String(body).slice(0, 400)
            }`
        )
    }
    return body
}

/** DHIS2 caps URL length, so ids go up in batches. */
const chunk = (items, size) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
        items.slice(i * size, i * size + size)
    )

const fetchByIds = async (prefix, type, ids, fields = ':owner') => {
    const out = []
    for (const batch of chunk(ids, 40)) {
        const page = await call(
            prefix,
            `/api/${type}.json?filter=id:in:[${batch.join(
                ','
            )}]&fields=${fields}&paging=false`
        )
        out.push(...(page[type] || []))
    }
    return out
}

/*
 * Principals do not travel between instances: the GHS user who created an
 * indicator has no account on the target, and an import naming one fails.
 * Public sharing survives; anything naming a specific user or group goes.
 */
const clean = (object) => {
    const next = { ...object }
    delete next.user
    delete next.createdBy
    delete next.lastUpdatedBy
    delete next.userAccesses
    delete next.userGroupAccesses
    if (next.sharing) {
        next.sharing = {
            ...next.sharing,
            owner: null,
            users: {},
            userGroups: {},
        }
    }
    return next
}

/**
 * Pull every metadata UID a DHIS2 expression refers to, grouped by the API
 * collection it lives in. The prefix before the brace decides the type; for
 * `#{...}` and `R{...}` the first dot-separated part is the object and the rest
 * are category option combos or a reporting-rate metric.
 */
const referencesIn = (expression, into) => {
    if (!expression) {
        return
    }
    const add = (type, id) => {
        if (id && /^[A-Za-z][A-Za-z0-9]{10}$/.test(id)) {
            into[type] = into[type] || new Set()
            into[type].add(id)
        }
    }
    for (const [, prefix, inner] of expression.matchAll(
        /([#CRIDAN]|OUG)\{([^}]+)\}/g
    )) {
        const parts = inner.split('.')
        switch (prefix) {
            case '#':
                add('dataElements', parts[0])
                parts.slice(1).forEach((p) => add('categoryOptionCombos', p))
                break
            case 'C':
                add('constants', parts[0])
                break
            case 'R':
                // R{dataSetUid.ACTUAL_REPORTS} - the metric is not a UID.
                add('dataSets', parts[0])
                break
            case 'I':
                add('programIndicators', parts[0])
                break
            case 'N':
                add('indicators', parts[0])
                break
            case 'D':
                add('programs', parts[0])
                add('dataElements', parts[1])
                break
            case 'A':
                add('programs', parts[0])
                add('trackedEntityAttributes', parts[1])
                break
            case 'OUG':
                add('organisationUnitGroups', parts[0])
                break
            default:
                break
        }
    }
}

const doExport = async () => {
    const out = value('out')
    if (!out) {
        console.error('export needs --out <file>')
        process.exit(2)
    }

    const { BUILTIN_INDICATOR_IDS } =
        await import('../src/framework/indicator-ids.js')
    const ids = [
        ...new Set(
            Object.values(BUILTIN_INDICATOR_IDS).flatMap((byCode) =>
                Object.values(byCode).map((entry) => entry.id)
            )
        ),
    ]

    const me = await call('SOURCE', '/api/me?fields=id,username')
    const info = await call('SOURCE', '/api/system/info.json')
    console.log(
        `Exporting ${ids.length} indicators from ${dhis2Server('SOURCE').base} ` +
            `(DHIS2 ${info.version}) as ${me.username}`
    )

    const indicators = await fetchByIds('SOURCE', 'indicators', ids)
    const found = new Set(indicators.map((i) => i.id))
    const absent = ids.filter((id) => !found.has(id))

    const requires = {}
    indicators.forEach((i) => {
        referencesIn(i.numerator, requires)
        referencesIn(i.denominator, requires)
    })

    const typeIds = [
        ...new Set(indicators.map((i) => i.indicatorType?.id).filter(Boolean)),
    ]
    const legendSetIds = [
        ...new Set(
            indicators.flatMap((i) => (i.legendSets || []).map((l) => l.id))
        ),
    ]

    const metadata = {
        indicatorTypes: (
            await fetchByIds('SOURCE', 'indicatorTypes', typeIds)
        ).map(clean),
        indicators: indicators.map(clean),
    }
    if (legendSetIds.length) {
        metadata.legendSets = (
            await fetchByIds('SOURCE', 'legendSets', legendSetIds)
        ).map(clean)
    }

    // The referenced objects are national metadata the target most likely
    // already has, so their definitions are only pulled when asked for.
    if (flag('with-dependencies')) {
        for (const [type, set] of Object.entries(requires)) {
            if (type === 'indicators') {
                continue
            }
            console.log(`  pulling ${set.size} ${type}…`)
            metadata[type] = (await fetchByIds('SOURCE', type, [...set])).map(
                clean
            )
        }
    }

    const payload = {
        meta: {
            source: dhis2Server('SOURCE').base,
            dhis2Version: info.version,
            exportedAt: new Date().toISOString(),
            withDependencies: flag('with-dependencies'),
        },
        // Requested UIDs the source did not have - always empty in a healthy
        // export, but worth recording rather than losing.
        absent,
        // What the expressions reach for. `probe` checks these against the
        // target; they are not shipped unless --with-dependencies was given.
        requires: Object.fromEntries(
            Object.entries(requires).map(([type, set]) => [
                type,
                [...set].sort(),
            ])
        ),
        metadata,
    }

    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)

    console.log(`\nWrote ${out}`)
    console.log('  shipped:')
    Object.entries(metadata).forEach(([type, objects]) =>
        console.log(`    ${type}: ${objects.length}`)
    )
    console.log('  referenced by the expressions:')
    Object.entries(payload.requires)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([type, list]) => console.log(`    ${type}: ${list.length}`))

    if (absent.length) {
        console.error(
            `\n${absent.length} shipped id(s) are not on the source instance: ${absent.join(', ')}`
        )
        process.exitCode = 1
    }
}

const doProbe = async () => {
    const input = value('in')
    if (!input) {
        console.error('probe needs --in <file>')
        process.exit(2)
    }
    const payload = JSON.parse(readFileSync(input, 'utf8'))

    const me = await call('TARGET', '/api/me?fields=id,username')
    const info = await call('TARGET', '/api/system/info.json')
    console.log(
        `Probing ${dhis2Server('TARGET').base} (DHIS2 ${info.version}) as ${me.username}\n`
    )

    let missingTotal = 0

    // Everything the indicators reach for, plus the indicators themselves so
    // the report says whether this is a first import or a refresh.
    const toCheck = {
        ...payload.requires,
        indicators: (payload.metadata.indicators || []).map((i) => i.id),
        indicatorTypes: (payload.metadata.indicatorTypes || []).map(
            (i) => i.id
        ),
    }

    for (const [type, ids] of Object.entries(toCheck).sort(([a], [b]) =>
        a.localeCompare(b)
    )) {
        if (!ids.length) {
            continue
        }
        const present = new Set(
            (await fetchByIds('TARGET', type, ids, 'id')).map((o) => o.id)
        )
        const missing = ids.filter((id) => !present.has(id))
        const shipped = Boolean(payload.metadata[type]?.length)

        console.log(
            `${type}: ${present.size}/${ids.length} present` +
                (missing.length
                    ? shipped
                        ? '  (this export supplies them)'
                        : '  ← NOT supplied by this export'
                    : '')
        )
        if (missing.length && !shipped) {
            missingTotal += missing.length
            console.log(
                `  missing: ${missing.slice(0, 12).join(', ')}${
                    missing.length > 12 ? `, … ${missing.length - 12} more` : ''
                }`
            )
        }
    }

    if (missingTotal) {
        console.error(
            `\n${missingTotal} referenced object(s) are missing from the target and are not in this ` +
                'export. The indicators would import but their expressions would not resolve.\n' +
                'Re-run export with --with-dependencies, and review what it pulls before importing.'
        )
        process.exitCode = 1
        return
    }
    console.log(
        '\nEvery referenced object already exists on the target. The indicators can be imported on their own.'
    )
}

const doImport = async () => {
    const input = value('in')
    if (!input) {
        console.error('import needs --in <file>')
        process.exit(2)
    }
    const dryRun = flag('dry-run')
    const { metadata } = JSON.parse(readFileSync(input, 'utf8'))

    const me = await call('TARGET', '/api/me?fields=id,username')
    console.log(
        `${dryRun ? 'Validating' : 'Importing'} ${input} against ` +
            `${dhis2Server('TARGET').base} as ${me.username}`
    )

    // Dependencies are created but never updated, so an import can add what is
    // missing without overwriting metadata the target has diverged on. The
    // indicators are the app's own, so those do get updated.
    const phases = [
        {
            name: 'dependencies',
            strategy: 'CREATE',
            payload: Object.fromEntries(
                Object.entries(metadata).filter(([t]) => t !== 'indicators')
            ),
        },
        {
            name: 'indicators',
            strategy: 'CREATE_AND_UPDATE',
            payload: { indicators: metadata.indicators || [] },
        },
    ]

    for (const phase of phases) {
        const count = Object.values(phase.payload).reduce(
            (n, list) => n + list.length,
            0
        )
        if (!count) {
            continue
        }

        // identifier=UID is what preserves the ids the app is bound to;
        // atomicMode=NONE so one bad object does not sink the batch.
        const params = new URLSearchParams({
            importMode: dryRun ? 'VALIDATE' : 'COMMIT',
            identifier: 'UID',
            importStrategy: phase.strategy,
            atomicMode: 'NONE',
            mergeMode: 'REPLACE',
            skipSharing: 'true',
        })

        const res = await call('TARGET', `/api/metadata?${params}`, {
            method: 'POST',
            body: JSON.stringify(phase.payload),
        })

        const stats = res?.stats || res?.response?.stats
        console.log(
            `\n${phase.name} (${phase.strategy}, ${count} objects): ${res.status}`
        )
        if (stats) {
            console.log(
                `  created ${stats.created}  updated ${stats.updated}  ` +
                    `ignored ${stats.ignored}  total ${stats.total}`
            )
        }

        const reports = res?.typeReports || res?.response?.typeReports || []
        reports.forEach((tr) => {
            const errors = (tr.objectReports || []).flatMap(
                (or) => or.errorReports || []
            )
            if (errors.length) {
                console.log(`  ${tr.klass?.split('.').pop()}:`)
                errors
                    .slice(0, 15)
                    .forEach((e) =>
                        console.log(`    ${e.errorCode}: ${e.message}`)
                    )
                if (errors.length > 15) {
                    console.log(`    … and ${errors.length - 15} more`)
                }
            }
        })

        if (res.status === 'ERROR') {
            process.exitCode = 1
        }
    }
}

const run = { export: doExport, probe: doProbe, import: doImport }[mode]

// `process.exitCode` rather than `process.exit()`: exiting from inside a
// rejected promise tears down libuv mid-flight and trips an assertion on Windows.
run().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
})
