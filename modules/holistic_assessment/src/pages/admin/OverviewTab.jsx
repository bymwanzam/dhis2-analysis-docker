import i18n from '@dhis2/d2-i18n'
import { CircularLoader, NoticeBox } from '@dhis2/ui'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import StatusTag from '../../components/StatusTag.jsx'
import {
    DEFAULT_FRAMEWORK_ID,
    DISTRICT_FRAMEWORK_ID,
    allIndicators,
    getFramework,
} from '../../framework/index.js'
import { useAppState } from '../../lib/AppState.jsx'
import { STATUS } from '../../lib/constants.js'
import {
    mappingForFramework,
    useAssessmentKeys,
    useDataStore,
    useIndicatorMapping,
} from '../../lib/datastore.js'
import { fmtPercent } from '../../lib/format.js'
import styles from '../AdminPage.module.css'

const ORDER = [
    STATUS.DRAFT,
    STATUS.SUBMITTED,
    STATUS.UNDER_REVIEW,
    STATUS.REVISION,
    STATUS.APPROVED,
    STATUS.REJECTED,
]

/** Where the assessment year stands, and how much of it DHIS2 can fill. */
export const OverviewTab = () => {
    const { year } = useAppState()
    const store = useDataStore()
    const { keys, loading: keysLoading } = useAssessmentKeys()
    const { value: allMapping } = useIndicatorMapping()

    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const yearKeys = useMemo(
        () => keys.filter((k) => k.year === year),
        [keys, year]
    )

    const load = useCallback(async () => {
        if (!yearKeys.length) {
            setRecords([])
            return
        }
        setLoading(true)
        setError(null)
        try {
            const loaded = await Promise.all(
                yearKeys.map((k) => store.read(k.key))
            )
            setRecords(loaded.filter(Boolean))
        } catch (e) {
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [yearKeys, store])

    useEffect(() => {
        load()
    }, [load])

    const byStatus = useMemo(() => {
        const counts = Object.fromEntries(ORDER.map((s) => [s, 0]))
        records.forEach((r) => {
            if (counts[r.status] !== undefined) {
                counts[r.status] += 1
            }
        })
        return counts
    }, [records])

    const coverage = useMemo(
        () =>
            [DEFAULT_FRAMEWORK_ID, DISTRICT_FRAMEWORK_ID].map((id) => {
                const framework = getFramework(id)
                const rows = allIndicators(framework)
                const mapping = mappingForFramework(allMapping, id)
                const bound = rows.filter((r) => mapping[r.code]?.id).length
                return {
                    id,
                    label:
                        id === DEFAULT_FRAMEWORK_ID
                            ? i18n.t('Regional')
                            : i18n.t('District'),
                    bound,
                    total: rows.length,
                }
            }),
        [allMapping]
    )

    if (keysLoading || loading) {
        return (
            <div className={styles.loading}>
                <CircularLoader />
            </div>
        )
    }

    if (error) {
        return (
            <NoticeBox error title={i18n.t('Could not load assessments')}>
                {error.message}
            </NoticeBox>
        )
    }

    return (
        <section>
            <h2 className={styles.sectionTitle}>
                {i18n.t('{{year}} assessments', { year })}
            </h2>
            {!records.length && (
                <NoticeBox title={i18n.t('Nothing saved yet')}>
                    {i18n.t(
                        'No assessment has been saved for {{year}}. Counts appear here as regions and districts begin.',
                        { year }
                    )}
                </NoticeBox>
            )}
            {records.length > 0 && (
                <div className={styles.statGrid}>
                    {ORDER.map((status) => (
                        <div key={status} className={styles.stat}>
                            <div className={styles.statValue}>
                                {byStatus[status]}
                            </div>
                            <StatusTag status={status} bold={false} />
                        </div>
                    ))}
                </div>
            )}

            <h2 className={styles.sectionTitle}>{i18n.t('DHIS2 coverage')}</h2>
            <p className={styles.sectionBody}>
                {i18n.t(
                    'How many rows of each tool are bound to a DHIS2 indicator. Unbound rows stay manual entry.'
                )}
            </p>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('Tool')}</th>
                        <th>{i18n.t('Bound')}</th>
                        <th>{i18n.t('Rows')}</th>
                        <th>{i18n.t('Coverage')}</th>
                    </tr>
                </thead>
                <tbody>
                    {coverage.map((c) => (
                        <tr key={c.id}>
                            <td>{c.label}</td>
                            <td>{c.bound}</td>
                            <td>{c.total}</td>
                            <td>{fmtPercent(c.bound / c.total, 0)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    )
}

export default OverviewTab
