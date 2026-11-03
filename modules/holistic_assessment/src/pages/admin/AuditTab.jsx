import i18n from '@dhis2/d2-i18n'
import { CircularLoader, NoticeBox } from '@dhis2/ui'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '../../lib/AppState.jsx'
import { useAssessmentKeys, useDataStore } from '../../lib/datastore.js'
import { fmtDateTime } from '../../lib/format.js'
import styles from '../AdminPage.module.css'

const LIMIT = 200

/**
 * Every assessment carries its own `history`; this pours them into one
 * timeline so a year can be read as a sequence of events rather than record by
 * record. Newest first, capped so a full national year stays readable.
 */
export const AuditTab = () => {
    const { year } = useAppState()
    const store = useDataStore()
    const { keys, loading: keysLoading } = useAssessmentKeys()

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

    const entries = useMemo(
        () =>
            records
                .flatMap((record) =>
                    (record.history || []).map((event) => ({
                        ...event,
                        orgUnit: record.orgUnit?.name || '—',
                        level: record.level,
                    }))
                )
                // Undated entries sort last rather than throwing off the order.
                .sort((a, b) =>
                    String(b.at || '').localeCompare(String(a.at || ''))
                ),
        [records]
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
            <NoticeBox error title={i18n.t('Could not load the audit trail')}>
                {error.message}
            </NoticeBox>
        )
    }

    if (!entries.length) {
        return (
            <NoticeBox title={i18n.t('Nothing recorded yet')}>
                {i18n.t(
                    'No assessment for {{year}} has any history. Entries appear as assessments are created, submitted and reviewed.',
                    { year }
                )}
            </NoticeBox>
        )
    }

    return (
        <section>
            <h2 className={styles.sectionTitle}>
                {i18n.t('Audit trail for {{year}}', { year })}
            </h2>
            <p className={styles.sectionBody}>
                {entries.length > LIMIT
                    ? i18n.t(
                          'Showing the most recent {{limit}} of {{total}} events.',
                          {
                              limit: LIMIT,
                              total: entries.length,
                          }
                      )
                    : i18n.t('{{total}} events.', { total: entries.length })}
            </p>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('When')}</th>
                        <th>{i18n.t('Organisation unit')}</th>
                        <th>{i18n.t('Action')}</th>
                        <th>{i18n.t('By')}</th>
                        <th>{i18n.t('Detail')}</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.slice(0, LIMIT).map((e, i) => (
                        <tr key={`${e.at}-${e.orgUnit}-${i}`}>
                            <td className={styles.nowrap}>
                                {fmtDateTime(e.at)}
                            </td>
                            <td>{e.orgUnit}</td>
                            <td>{e.action || '—'}</td>
                            <td>{e.by || '—'}</td>
                            <td>{e.detail || e.comment || ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    )
}

export default AuditTab
