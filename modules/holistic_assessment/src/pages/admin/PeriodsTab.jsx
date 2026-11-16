import i18n from '@dhis2/d2-i18n'
import {
    AlertBar,
    Button,
    CircularLoader,
    NoticeBox,
    SingleSelectField,
    SingleSelectOption,
    Tag,
} from '@dhis2/ui'
import React, { useMemo, useState } from 'react'
import {
    PERIOD_STATUS,
    PERIOD_STATUS_DESCRIPTION,
    PERIOD_STATUS_LABEL,
    PERIOD_STATUS_TONE,
} from '../../lib/constants.js'
import { usePeriods } from '../../lib/datastore.js'
import { assessmentYears, fmtDateTime } from '../../lib/format.js'
import { ORG_LEVEL, scopeOf, useCurrentUser } from '../../lib/useCurrentUser.js'
import { periodOf } from '../../lib/workflow.js'
import styles from '../AdminPage.module.css'

const ORDER = [
    PERIOD_STATUS.OPEN,
    PERIOD_STATUS.CLOSED,
    PERIOD_STATUS.LOCKED,
    PERIOD_STATUS.ARCHIVED,
]

const tagProps = (status) => {
    const tone = PERIOD_STATUS_TONE[status]
    return tone === 'default' ? {} : { [tone]: true }
}

/**
 * When a year accepts submissions.
 *
 * A year with nothing stored is open. That is deliberate: the gate is opted
 * into, so adding periods to an instance that already holds assessments does
 * not freeze every past year the moment the app is upgraded. An administrator
 * creates a period for the year they want to control, and only then does it
 * start to bite.
 *
 * Creating and opening a period is national work — it decides when the whole
 * country submits. A regional administrator can see the state of each year,
 * because it governs whether their region can submit, but cannot change it.
 */
export const PeriodsTab = () => {
    const user = useCurrentUser()
    const canManage = scopeOf(user) <= ORG_LEVEL.NATIONAL

    const { value: periods, save, loading } = usePeriods()
    const [busy, setBusy] = useState(null)
    const [alert, setAlert] = useState(null)
    const [newYear, setNewYear] = useState(() => new Date().getFullYear() - 1)

    const years = useMemo(() => {
        const stored = Object.keys(periods || {})
            .map(Number)
            .filter(Number.isFinite)
        return [...new Set(stored)].sort((a, b) => b - a)
    }, [periods])

    const notify = (message, tone = 'success') =>
        setAlert({ message, tone, id: Date.now() })

    const write = async (year, patch, message) => {
        setBusy(year)
        try {
            const key = String(year)
            const next = {
                ...(periods || {}),
                [key]: {
                    ...(periods?.[key] || {}),
                    ...patch,
                    updatedAt: new Date().toISOString(),
                    updatedBy: user.user?.username || null,
                },
            }
            await save(next)
            notify(message)
        } catch (e) {
            notify(e.message, 'critical')
        } finally {
            setBusy(null)
        }
    }

    const handleCreate = () =>
        write(
            newYear,
            {
                status: PERIOD_STATUS.OPEN,
                createdAt: new Date().toISOString(),
                createdBy: user.user?.username || null,
            },
            i18n.t('Period created for {{year}}', { year: newYear })
        )

    const handleSetStatus = (year, status) =>
        write(
            year,
            { status },
            i18n.t('{{year}} is now {{status}}', {
                year,
                status: PERIOD_STATUS_LABEL[status].toLowerCase(),
            })
        )

    if (loading) {
        return (
            <div className={styles.loading}>
                <CircularLoader />
            </div>
        )
    }

    const untracked = assessmentYears().filter((y) => !years.includes(y))

    return (
        <section>
            {alert && (
                <AlertBar
                    key={alert.id}
                    duration={5000}
                    success={alert.tone === 'success'}
                    critical={alert.tone === 'critical'}
                    onHidden={() => setAlert(null)}
                >
                    {alert.message}
                </AlertBar>
            )}

            <h2 className={styles.sectionTitle}>{i18n.t('Periods')}</h2>

            {canManage && untracked.length > 0 && (
                <div className={styles.formRow}>
                    <div className={styles.field}>
                        <SingleSelectField
                            dense
                            label={i18n.t('Year')}
                            selected={String(newYear)}
                            onChange={({ selected }) =>
                                setNewYear(Number(selected))
                            }
                        >
                            {untracked.map((y) => (
                                <SingleSelectOption
                                    key={y}
                                    label={String(y)}
                                    value={String(y)}
                                />
                            ))}
                        </SingleSelectField>
                    </div>
                    <div className={styles.field}>
                        <Button
                            small
                            primary
                            loading={busy === newYear}
                            onClick={handleCreate}
                        >
                            {i18n.t('Create period')}
                        </Button>
                    </div>
                </div>
            )}

            {years.length === 0 ? (
                <NoticeBox title={i18n.t('No periods recorded')}>
                    {i18n.t(
                        'Every year is open until a period is created for it. Create one for the year you want to control; the others are unaffected.'
                    )}
                </NoticeBox>
            ) : (
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{i18n.t('Year')}</th>
                                <th>{i18n.t('Status')}</th>
                                <th>{i18n.t('What it means')}</th>
                                <th>{i18n.t('Last changed')}</th>
                                {canManage && <th>{i18n.t('Change to')}</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {years.map((year) => {
                                const period = periodOf(periods, year)
                                return (
                                    <tr key={year}>
                                        <th scope="row">{year}</th>
                                        <td>
                                            <Tag {...tagProps(period.status)}>
                                                {
                                                    PERIOD_STATUS_LABEL[
                                                        period.status
                                                    ]
                                                }
                                            </Tag>
                                        </td>
                                        <td>
                                            {
                                                PERIOD_STATUS_DESCRIPTION[
                                                    period.status
                                                ]
                                            }
                                        </td>
                                        <td>
                                            {period.updatedAt
                                                ? fmtDateTime(period.updatedAt)
                                                : '—'}
                                        </td>
                                        {canManage && (
                                            <td className={styles.actions}>
                                                {ORDER.filter(
                                                    (s) => s !== period.status
                                                ).map((status) => (
                                                    <Button
                                                        key={status}
                                                        small
                                                        secondary
                                                        loading={busy === year}
                                                        onClick={() =>
                                                            handleSetStatus(
                                                                year,
                                                                status
                                                            )
                                                        }
                                                    >
                                                        {
                                                            PERIOD_STATUS_LABEL[
                                                                status
                                                            ]
                                                        }
                                                    </Button>
                                                ))}
                                            </td>
                                        )}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {!canManage && (
                <NoticeBox title={i18n.t('Read-only outside national')}>
                    {i18n.t(
                        'A period decides when the whole country submits, so it is opened and closed nationally. It is shown here because it governs whether your own assessments can be submitted.'
                    )}
                </NoticeBox>
            )}

            <NoticeBox title={i18n.t('A closed year is not a locked one')}>
                {i18n.t(
                    'Closing a year stops new submissions but leaves data entry alone, so work in progress is not lost the moment a deadline passes. Locking stops editing too. Neither ever blocks a reviewer from finishing a review already under way — a review that could not be completed would strand the assessment it belongs to.'
                )}
            </NoticeBox>
        </section>
    )
}

export default PeriodsTab
