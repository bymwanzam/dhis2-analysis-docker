import { useDataEngine } from '@dhis2/app-runtime'
import { useCallback, useState } from 'react'

/**
 * Pull current- and previous-year values for indicators that have been mapped
 * to a DHIS2 indicator or data element on the Admin page.
 *
 * `mapping` is { '<indicator code>': { id, name, type } }. Codes without a
 * mapping stay manual-entry, which is what the workflow guide calls "Manual".
 */
export const useDhis2Values = () => {
    const engine = useDataEngine()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [lastResult, setLastResult] = useState(null)

    const fetchValues = useCallback(
        async ({ mapping, orgUnitId, year }) => {
            const entries = Object.entries(mapping || {}).filter(
                ([, m]) => m && m.id
            )
            if (!entries.length || !orgUnitId || !year) {
                const empty = { values: {}, matched: 0, requested: 0 }
                setLastResult(empty)
                return empty
            }

            setLoading(true)
            setError(null)
            try {
                const dx = [...new Set(entries.map(([, m]) => m.id))]
                const periods = [String(year), String(year - 1)]

                const res = await engine.query({
                    analytics: {
                        resource: 'analytics',
                        params: {
                            dimension: [
                                `dx:${dx.join(';')}`,
                                `pe:${periods.join(';')}`,
                            ],
                            filter: `ou:${orgUnitId}`,
                            skipMeta: true,
                            outputIdScheme: 'UID',
                        },
                    },
                })

                const headers = res.analytics?.headers || []
                const rows = res.analytics?.rows || []
                const dxIdx = headers.findIndex((h) => h.name === 'dx')
                const peIdx = headers.findIndex((h) => h.name === 'pe')
                const valIdx = headers.findIndex((h) => h.name === 'value')

                // dx id -> { '2025': n, '2024': n }
                const byDx = new Map()
                if (dxIdx >= 0 && peIdx >= 0 && valIdx >= 0) {
                    rows.forEach((row) => {
                        const id = row[dxIdx]
                        const pe = row[peIdx]
                        const value = Number(row[valIdx])
                        if (!Number.isFinite(value)) {
                            return
                        }
                        if (!byDx.has(id)) {
                            byDx.set(id, {})
                        }
                        byDx.get(id)[pe] = value
                    })
                }

                const values = {}
                let matched = 0
                entries.forEach(([code, m]) => {
                    const found = byDx.get(m.id)
                    if (!found) {
                        return
                    }
                    const current = found[String(year)]
                    const previous = found[String(year - 1)]
                    if (current === undefined && previous === undefined) {
                        return
                    }
                    matched += 1
                    values[code] = {
                        current: current ?? null,
                        previous: previous ?? null,
                        source: 'dhis2',
                        fetchedAt: new Date().toISOString(),
                    }
                })

                const result = { values, matched, requested: entries.length }
                setLastResult(result)
                return result
            } catch (e) {
                setError(e)
                throw e
            } finally {
                setLoading(false)
            }
        },
        [engine]
    )

    return { fetchValues, loading, error, lastResult }
}

/** Search DHIS2 indicators and data elements for the Admin mapping page. */
export const useMetadataSearch = () => {
    const engine = useDataEngine()
    const [loading, setLoading] = useState(false)
    const [results, setResults] = useState([])
    const [error, setError] = useState(null)

    const search = useCallback(
        async (term) => {
            const q = (term || '').trim()
            if (q.length < 2) {
                setResults([])
                return []
            }
            setLoading(true)
            setError(null)
            try {
                const params = {
                    fields: 'id,displayName',
                    filter: `displayName:ilike:${q}`,
                    paging: true,
                    pageSize: 25,
                    order: 'displayName:asc',
                }
                const res = await engine.query({
                    indicators: { resource: 'indicators', params },
                    dataElements: { resource: 'dataElements', params },
                })
                const combined = [
                    ...(res.indicators?.indicators || []).map((x) => ({
                        ...x,
                        type: 'INDICATOR',
                    })),
                    ...(res.dataElements?.dataElements || []).map((x) => ({
                        ...x,
                        type: 'DATA_ELEMENT',
                    })),
                ]
                setResults(combined)
                return combined
            } catch (e) {
                setError(e)
                return []
            } finally {
                setLoading(false)
            }
        },
        [engine]
    )

    return { search, results, loading, error, setResults }
}
