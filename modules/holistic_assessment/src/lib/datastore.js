import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    DEFAULT_FRAMEWORK_ID,
    frameworkIdForLevel,
} from '../framework/index.js'
import { builtinIdsFor, withBuiltinIds } from '../framework/indicator-ids.js'
import { apiFetch } from './api.js'
import {
    MAPPING_KEY,
    PAIRING_KEY,
    PERIODS_KEY,
    SETTINGS_KEY,
    STATUS,
    TARGETS_KEY,
} from './constants.js'

export const assessmentKey = (year, orgUnitId) =>
    `assessment-${year}-${orgUnitId}`

const isNotFound = (error) => {
    const status = error?.details?.httpStatusCode ?? error?.httpStatusCode
    return (
        status === 404 || /not found|does not exist/i.test(error?.message || '')
    )
}

/** A brand-new, empty assessment record. */
export const emptyAssessment = ({ year, orgUnit, level, frameworkId }) => ({
    version: 1,
    frameworkId: frameworkId || frameworkIdForLevel(level),
    year,
    level,
    orgUnit: orgUnit
        ? {
              id: orgUnit.id,
              name: orgUnit.displayName || orgUnit.name,
              level: orgUnit.level,
              parentId: orgUnit.parent?.id || null,
              parentName:
                  orgUnit.parent?.displayName || orgUnit.parent?.name || null,
          }
        : null,
    status: STATUS.DRAFT,
    values: {},
    milestones: {},
    review: null,
    response: null,
    history: [],
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
})

const storeUrl = (key) =>
    key ? `/api/store/${encodeURIComponent(key)}` : '/api/store'

const versionFrom = (res) => {
    const n = Number((res.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, ''))
    return Number.isInteger(n) && n > 0 ? n : null
}

/** Read one key with its version, treating "missing" as null rather than an error. */
const readEntry = async (key) => {
    try {
        const { data, res } = await apiFetch(storeUrl(key))
        return { value: data, version: versionFrom(res) }
    } catch (error) {
        if (isNotFound(error)) {
            return null
        }
        throw error
    }
}

/**
 * Write one key.
 *
 * `version` is the version the edit was based on: a number to require that
 * the stored record is still that version, `null` to require that it does not
 * exist yet, or left out to write regardless. A record somebody else saved in
 * the meantime is refused with a 409 rather than silently overwritten.
 */
const writeKey = async (key, value, { version } = {}) => {
    const headers =
        version === undefined
            ? {}
            : version === null
              ? { 'If-None-Match': '*' }
              : { 'If-Match': `"${version}"` }
    const { data } = await apiFetch(storeUrl(key), {
        method: 'PUT',
        body: value,
        headers,
    })
    return { version: data?.version ?? null }
}

/**
 * The app's record store. It used to be the DHIS2 datastore namespace; it is
 * now this app's own server, which checks every write against the workflow
 * rules before keeping it.
 */
export const useDataStore = () =>
    useMemo(
        () => ({
            read: async (key) => (await readEntry(key))?.value ?? null,
            readEntry,
            write: writeKey,
            remove: (key) => apiFetch(storeUrl(key), { method: 'DELETE' }),
            listKeys: async () => {
                const { data } = await apiFetch(storeUrl())
                return Array.isArray(data) ? data : []
            },
        }),
        []
    )

/** A write refused because somebody else saved first. */
export const isConflict = (error) =>
    (error?.status ?? error?.details?.httpStatusCode) === 409

/**
 * Load a single dataStore key into component state.
 * Returns the value, loading/error state, a refetch and an imperative save.
 */
export const useStoreValue = (key, fallback = null) => {
    const store = useDataStore()
    const [value, setValue] = useState(fallback)
    const [loading, setLoading] = useState(Boolean(key))
    const [error, setError] = useState(null)
    const latestKey = useRef(key)
    // The version last read or written, so a save can be refused if somebody
    // else has changed the key since.
    const version = useRef(null)

    const load = useCallback(async () => {
        if (!key) {
            setValue(fallback)
            setLoading(false)
            return
        }
        latestKey.current = key
        setLoading(true)
        setError(null)
        try {
            const stored = await store.readEntry(key)
            // Ignore responses for a key we have already navigated away from.
            if (latestKey.current === key) {
                version.current = stored?.version ?? null
                setValue(stored === null ? fallback : stored.value)
            }
        } catch (e) {
            if (latestKey.current === key) {
                setError(e)
            }
        } finally {
            if (latestKey.current === key) {
                setLoading(false)
            }
        }
        // `fallback` is intentionally excluded: callers pass a fresh object literal
        // on every render, which would otherwise reload in a loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, store])

    useEffect(() => {
        load()
    }, [load])

    const save = useCallback(
        async (next) => {
            if (!key) {
                return
            }
            const written = await store.write(key, next, {
                version: version.current,
            })
            version.current = written.version
            setValue(next)
        },
        [key, store]
    )

    return { value, setValue, loading, error, refetch: load, save }
}

export const useSettings = () =>
    useStoreValue(SETTINGS_KEY, {
        frameworkId: DEFAULT_FRAMEWORK_ID,
        defaultYear: new Date().getFullYear() - 1,
        organisationName: 'Ghana Health Service',
    })

export const useIndicatorMapping = () => useStoreValue(MAPPING_KEY, {})

/**
 * Indicator mapping is stored per framework, because the regional and district
 * tools reuse the same codes for different indicators — 1.17 is "Doctor to
 * population ratio" regionally but "Physician Assistant to population ratio" in
 * a district, so one shared code-keyed mapping would bind the wrong data.
 */
const isLegacyFlatMapping = (mapping) =>
    Object.values(mapping || {}).some(
        (v) => v && typeof v === 'object' && typeof v.id === 'string'
    )

/** What an administrator has saved for one tool, before built-ins are layered in. */
export const storedMappingForFramework = (mapping, frameworkId) => {
    if (!mapping) {
        return {}
    }
    // A mapping saved before frameworks were split described the regional tool.
    if (isLegacyFlatMapping(mapping)) {
        return frameworkId === DEFAULT_FRAMEWORK_ID ? mapping : {}
    }
    return mapping[frameworkId] || {}
}

/**
 * The bindings in force for one tool: what the app ships in
 * `framework/indicator-ids.js`, overridden by whatever the administrator saved.
 */
export const mappingForFramework = (mapping, frameworkId) =>
    withBuiltinIds(frameworkId, storedMappingForFramework(mapping, frameworkId))

/**
 * Reduce an edited mapping to what actually has to be stored: entries that
 * differ from the shipped binding, plus a `null` tombstone wherever a shipped
 * binding was cleared. Anything still equal to a built-in stays out of the
 * datastore, so a corrected id in a later release reaches installs that never
 * touched that row.
 */
export const strippedOfBuiltins = (frameworkId, edited) => {
    const builtin = builtinIdsFor(frameworkId)
    return Object.fromEntries(
        Object.entries(edited || {}).filter(([code, entry]) => {
            if (entry === null) {
                return Boolean(builtin[code])
            }
            return Boolean(entry?.id) && entry.id !== builtin[code]?.id
        })
    )
}

export const withFrameworkMapping = (mapping, frameworkId, next) => {
    const base = isLegacyFlatMapping(mapping)
        ? { [DEFAULT_FRAMEWORK_ID]: mapping }
        : { ...(mapping || {}) }
    return { ...base, [frameworkId]: next }
}

export const usePeerPairings = () => useStoreValue(PAIRING_KEY, {})

/**
 * Year-level target overrides, `{ [year]: { [frameworkId]: { [code]: {...} } } }`.
 * Empty until somebody edits a target, and a framework with no overrides scores
 * exactly as it did before the Targets tab existed.
 */
export const useTargets = () => useStoreValue(TARGETS_KEY, {})

/**
 * Assessment periods, `{ [year]: { status, opensAt, closesAt, ... } }`.
 *
 * A year with no entry is open: the gate has to be opted into, so adding it to
 * an instance that already holds assessments does not freeze every past year.
 */
export const usePeriods = () => useStoreValue(PERIODS_KEY, {})

/** Every stored assessment key, parsed into { key, year, orgUnitId }. */
export const useAssessmentKeys = () => {
    const store = useDataStore()
    const [keys, setKeys] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const all = await store.listKeys()
            setKeys(
                all
                    .filter((k) => k.startsWith('assessment-'))
                    .map((k) => {
                        const [, year, ...rest] = k.split('-')
                        return {
                            key: k,
                            year: Number(year),
                            orgUnitId: rest.join('-'),
                        }
                    })
                    .filter((k) => Number.isFinite(k.year) && k.orgUnitId)
            )
        } catch (e) {
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [store])

    useEffect(() => {
        load()
    }, [load])

    return { keys, loading, error, refetch: load }
}

/** Append an audit entry without mutating the record in place. */
export const withHistory = (assessment, entry) => ({
    ...assessment,
    history: [
        ...(assessment.history || []),
        { at: new Date().toISOString(), ...entry },
    ],
})
