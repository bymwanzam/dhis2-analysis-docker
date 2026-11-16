import i18n from '@dhis2/d2-i18n'
import { CircularLoader, NoticeBox } from '@dhis2/ui'
import PropTypes from 'prop-types'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import StatusTag from '../components/StatusTag.jsx'
import { useAppState } from '../lib/AppState.jsx'
import { LEVEL, PERFORMANCE_LABEL, STATUS } from '../lib/constants.js'
import { useAssessmentKeys, useDataStore } from '../lib/datastore.js'
import {
    fmtPercent,
    fmtPerformance,
    performanceCategory,
} from '../lib/format.js'
import { scoreAssessment } from '../lib/scoring.js'
import { ORG_LEVEL, scopeOf, useCurrentUser } from '../lib/useCurrentUser.js'
import { useScoringFramework } from '../lib/useScoringFramework.js'
import styles from './DashboardPage.module.css'

/** An assessment counts as complete once it has left the owner's hands. */
const SUBMITTED_ONWARDS = new Set([
    STATUS.SUBMITTED,
    STATUS.UNDER_REVIEW,
    STATUS.APPROVED,
])

const Tile = ({ value, label, tone }) => (
    <div className={styles.tile}>
        <div className={styles.tileValue} data-tone={tone}>
            {value}
        </div>
        <div className={styles.tileLabel}>{label}</div>
    </div>
)

Tile.propTypes = {
    label: PropTypes.string.isRequired,
    tone: PropTypes.oneOf(['neutral', 'up', 'down']),
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
}

/**
 * One row per org unit: where its assessment has got to and how it scored. Used
 * twice — the regions of the country, and the districts of one region — because
 * the two answer the same question at different levels.
 *
 * Ordered by name rather than by score: this is somewhere to look a unit up.
 * Reports is where the league table lives.
 */
const StatusTable = ({ rows, unitLabel }) => (
    <div className={styles.tableWrapper}>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{unitLabel}</th>
                    <th>{i18n.t('Status')}</th>
                    <th className={styles.numeric}>
                        {i18n.t('Overall score')}
                    </th>
                    <th>{i18n.t('Performance')}</th>
                </tr>
            </thead>
            <tbody>
                {rows.map(({ record, result }, i) => (
                    <tr key={record.orgUnit?.id || i}>
                        <th scope="row">{record.orgUnit?.name}</th>
                        <td>
                            <StatusTag status={record.status} />
                        </td>
                        {/*
                            The band fills the score cell and names itself in
                            the column beside it, so the colour is a second
                            reading of something already written down.
                        */}
                        <td
                            className={styles.score}
                            data-performance={performanceCategory(
                                result.performance
                            )}
                        >
                            {fmtPerformance(result.performance)}
                        </td>
                        <td>
                            {
                                PERFORMANCE_LABEL[
                                    performanceCategory(result.performance)
                                ]
                            }
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
)

StatusTable.propTypes = {
    rows: PropTypes.array.isRequired,
    unitLabel: PropTypes.string.isRequired,
}

/** Orders scored records by org unit name, for the tables above. */
const byName = (a, b) =>
    (a.record.orgUnit?.name || '').localeCompare(b.record.orgUnit?.name || '')

/**
 * Landing page: how the signed-in user's own region or district is doing this
 * year, against the national picture and broken down by objective.
 *
 * Everything here is derived from the assessments already in the datastore, so
 * it needs no analytics call of its own.
 */
export const DashboardPage = () => {
    const { year } = useAppState()
    const store = useDataStore()
    const { resolve: resolveFramework } = useScoringFramework(year)
    const user = useCurrentUser()
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

    /*
     * Which dashboard this is. A national account sees the country and its
     * regions, a regional account its region and its districts, a district
     * account its own district — the same remit that gates the Admin tabs.
     */
    const isNational = scopeOf(user) === ORG_LEVEL.NATIONAL

    const scored = useMemo(
        () =>
            records.map((record) => ({
                record,
                result: scoreAssessment(
                    resolveFramework(record.frameworkId),
                    record.values,
                    record.milestones
                ),
            })),
        [records, resolveFramework]
    )

    // The user's own unit is whichever of their assigned org units has an
    // assessment this year; failing that, simply their first.
    const mine = useMemo(() => {
        const ids = new Set(user.orgUnitIds)
        return scored.find((s) => ids.has(s.record.orgUnit?.id)) || null
    }, [scored, user.orgUnitIds])

    const ownUnitName =
        mine?.record.orgUnit?.name || user.orgUnits[0]?.displayName || null

    const regions = useMemo(
        () => scored.filter((s) => s.record.level === LEVEL.REGION),
        [scored]
    )

    const regionsByName = useMemo(() => [...regions].sort(byName), [regions])

    const districts = useMemo(
        () => scored.filter((s) => s.record.level === LEVEL.DISTRICT),
        [scored]
    )

    /*
     * The national score is the mean of the regional scores, unweighted — the
     * same figure the tile beneath the user's own card compares against, so the
     * two can never disagree. Districts do not enter it: they are assessed on
     * their own instrument, against their own targets, and averaging the two
     * instruments together would produce a number that answers no question.
     */
    const nationalAverage = useMemo(
        () =>
            regions.length
                ? regions.reduce((sum, s) => sum + s.result.performance, 0) /
                  regions.length
                : null,
        [regions]
    )

    /*
     * And the same mean taken objective by objective. Every region is scored on
     * the same three objectives in the same order, so averaging by index is
     * sound; the titles come from the first region that has them.
     */
    const nationalObjectives = useMemo(() => {
        if (!regions.length) {
            return []
        }
        return regions[0].result.objectives.map((objective, i) => ({
            index: objective.index,
            title: objective.title,
            performance:
                regions.reduce(
                    (sum, s) =>
                        sum + (s.result.objectives[i]?.performance || 0),
                    0
                ) / regions.length,
        }))
    }, [regions])

    const completed = (rows) =>
        rows.filter((s) => SUBMITTED_ONWARDS.has(s.record.status)).length

    // Districts of the user's own region, which is what its own counts mean.
    const myDistricts = useMemo(() => {
        const parentId = mine?.record.orgUnit?.id
        if (!parentId) {
            return []
        }
        return scored
            .filter(
                (s) =>
                    s.record.level === LEVEL.DISTRICT &&
                    s.record.orgUnit?.parentId === parentId
            )
            .sort(byName)
    }, [scored, mine])

    const rank = useMemo(() => {
        if (!mine || mine.record.level !== LEVEL.REGION) {
            return null
        }
        const ordered = [...regions].sort(
            (a, b) => b.result.performance - a.result.performance
        )
        const at = ordered.findIndex(
            (s) => s.record.orgUnit?.id === mine.record.orgUnit?.id
        )
        return at >= 0 ? { position: at + 1, of: ordered.length } : null
    }, [mine, regions])

    const busy = keysLoading || loading

    if (busy) {
        return (
            <div className={styles.loading}>
                <CircularLoader />
            </div>
        )
    }

    if (error) {
        return (
            <NoticeBox error title={i18n.t('Could not load the dashboard')}>
                {error.message}
            </NoticeBox>
        )
    }

    const nationalCategory =
        nationalAverage === null ? null : performanceCategory(nationalAverage)

    const level = isNational
        ? i18n.t('National')
        : mine?.record.level === LEVEL.DISTRICT
          ? i18n.t('District')
          : i18n.t('Regional')

    return (
        <div>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    {i18n.t('{{year}} {{level}} Assessment Dashboard', {
                        year,
                        level,
                    })}
                </h1>
                <p className={styles.subtitle}>
                    {isNational
                        ? i18n.t('Performance overview for the country')
                        : ownUnitName
                          ? i18n.t('Performance overview for {{name}}', {
                                name: ownUnitName,
                            })
                          : i18n.t('Performance overview')}
                </p>
            </header>

            {/*
                A national account sees the country and the regions under it; a
                regional account its region and the districts under it; a
                district account its own district. One level, and the tier
                immediately below it — never all three stacked on one page.
            */}
            {isNational ? (
                nationalAverage === null ? (
                    <NoticeBox
                        title={i18n.t('No assessments for {{year}}', { year })}
                    >
                        {i18n.t(
                            'No regional assessment has been saved for this year yet, so there is no national picture to show.'
                        )}
                    </NoticeBox>
                ) : (
                    <>
                        <section
                            className={styles.card}
                            data-performance={nationalCategory}
                        >
                            <div className={styles.hero}>
                                <div>
                                    <div className={styles.heroName}>
                                        {i18n.t('National')}
                                    </div>
                                    <div className={styles.heroMeta}>
                                        {i18n.t(
                                            'Average of {{count}} regions assessed',
                                            { count: regions.length }
                                        )}
                                    </div>
                                </div>
                                <div className={styles.heroScore}>
                                    <div className={styles.heroValue}>
                                        {fmtPerformance(nationalAverage)}
                                    </div>
                                    <div className={styles.heroCategory}>
                                        {PERFORMANCE_LABEL[nationalCategory]}
                                    </div>
                                </div>
                            </div>

                            <div className={styles.tiles}>
                                <Tile
                                    tone="neutral"
                                    value={regions.length}
                                    label={i18n.t('Regions')}
                                />
                                <Tile
                                    tone="neutral"
                                    value={completed(regions)}
                                    label={i18n.t('Regions completed')}
                                />
                                <Tile
                                    tone="neutral"
                                    value={districts.length}
                                    label={i18n.t('Districts')}
                                />
                                <Tile
                                    tone="neutral"
                                    value={completed(districts)}
                                    label={i18n.t('Districts completed')}
                                />
                            </div>
                        </section>

                        <section className={styles.panel}>
                            <h2 className={styles.panelTitle}>
                                {i18n.t('National Performance by Objective')}
                            </h2>
                            <div className={styles.objectives}>
                                {nationalObjectives.map((objective) => (
                                    <div
                                        key={objective.index}
                                        className={styles.objective}
                                        data-objective={objective.index}
                                        data-performance={performanceCategory(
                                            objective.performance
                                        )}
                                    >
                                        <div className={styles.objectiveValue}>
                                            {fmtPerformance(
                                                objective.performance
                                            )}
                                        </div>
                                        <div className={styles.objectiveTitle}>
                                            {objective.title}
                                        </div>
                                        <div className={styles.objectiveMeta}>
                                            {
                                                PERFORMANCE_LABEL[
                                                    performanceCategory(
                                                        objective.performance
                                                    )
                                                ]
                                            }
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className={styles.panel}>
                            <h2 className={styles.panelTitle}>
                                {i18n.t('Regional Assessment Status')}
                            </h2>
                            <StatusTable
                                rows={regionsByName}
                                unitLabel={i18n.t('Region')}
                            />
                        </section>
                    </>
                )
            ) : (
                <>
                    {!mine && (
                        <NoticeBox
                            title={i18n.t('No assessment for {{year}}', {
                                year,
                            })}
                        >
                            {ownUnitName
                                ? i18n.t(
                                      'Nothing has been saved for {{name}} yet. Open the assessment to begin.',
                                      { name: ownUnitName }
                                  )
                                : i18n.t(
                                      'Your DHIS2 account is not assigned to a region or district with an assessment this year.'
                                  )}
                        </NoticeBox>
                    )}

                    {mine && (
                        <>
                            {/*
                        The hero carries the headline score. `data-performance`
                        colours it, and the category is written out underneath,
                        so the colour is never the only thing saying how the
                        region is doing.
                    */}
                            <section
                                className={styles.card}
                                data-performance={performanceCategory(
                                    mine.result.performance
                                )}
                            >
                                <div className={styles.hero}>
                                    <div>
                                        <div className={styles.heroName}>
                                            {mine.record.orgUnit?.name}
                                        </div>
                                        <div className={styles.heroMeta}>
                                            {rank
                                                ? i18n.t(
                                                      'Ranked {{position}} of {{of}} regions',
                                                      rank
                                                  )
                                                : i18n.t('{{pct}} complete', {
                                                      pct: fmtPercent(
                                                          mine.result
                                                              .completion,
                                                          0
                                                      ),
                                                  })}
                                        </div>
                                    </div>
                                    <div className={styles.heroScore}>
                                        <div className={styles.heroValue}>
                                            {fmtPerformance(
                                                mine.result.performance
                                            )}
                                        </div>
                                        <div className={styles.heroCategory}>
                                            {
                                                PERFORMANCE_LABEL[
                                                    performanceCategory(
                                                        mine.result.performance
                                                    )
                                                ]
                                            }
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.tiles}>
                                    <Tile
                                        tone="neutral"
                                        value={
                                            nationalAverage === null
                                                ? '—'
                                                : fmtPerformance(
                                                      nationalAverage
                                                  )
                                        }
                                        label={i18n.t('National Average')}
                                    />
                                    <Tile
                                        tone={
                                            nationalAverage === null
                                                ? 'neutral'
                                                : mine.result.performance >=
                                                    nationalAverage
                                                  ? 'up'
                                                  : 'down'
                                        }
                                        value={
                                            nationalAverage === null
                                                ? '—'
                                                : `${
                                                      mine.result.performance >=
                                                      nationalAverage
                                                          ? '+'
                                                          : ''
                                                  }${(
                                                      mine.result.performance -
                                                      nationalAverage
                                                  ).toFixed(2)}`
                                        }
                                        label={i18n.t('vs National Avg')}
                                    />
                                    <Tile
                                        tone="neutral"
                                        value={myDistricts.length}
                                        label={i18n.t('Districts')}
                                    />
                                    <Tile
                                        tone="neutral"
                                        value={
                                            myDistricts.filter((s) =>
                                                SUBMITTED_ONWARDS.has(
                                                    s.record.status
                                                )
                                            ).length
                                        }
                                        label={i18n.t('Completed')}
                                    />
                                </div>
                            </section>

                            <section className={styles.panel}>
                                <h2 className={styles.panelTitle}>
                                    {i18n.t('Performance by Objective')}
                                </h2>
                                <div className={styles.objectives}>
                                    {mine.result.objectives.map((objective) => (
                                        <div
                                            key={objective.index}
                                            className={styles.objective}
                                            data-objective={objective.index}
                                            data-performance={performanceCategory(
                                                objective.performance
                                            )}
                                        >
                                            <div
                                                className={
                                                    styles.objectiveValue
                                                }
                                            >
                                                {fmtPerformance(
                                                    objective.performance
                                                )}
                                            </div>
                                            <div
                                                className={
                                                    styles.objectiveTitle
                                                }
                                            >
                                                {objective.title}
                                            </div>
                                            <div
                                                className={styles.objectiveMeta}
                                            >
                                                {i18n.t(
                                                    '{{answered}} of {{total}} rows · {{label}}',
                                                    {
                                                        answered:
                                                            objective.answered,
                                                        total: objective.total,
                                                        label: PERFORMANCE_LABEL[
                                                            performanceCategory(
                                                                objective.performance
                                                            )
                                                        ],
                                                    }
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/*
                        Only a region has districts under it, so a district user
                        sees the two panels above and stops there.
                    */}
                            {myDistricts.length > 0 && (
                                <section className={styles.panel}>
                                    <h2 className={styles.panelTitle}>
                                        {i18n.t('District Assessment Status')}
                                    </h2>
                                    <StatusTable
                                        rows={myDistricts}
                                        unitLabel={i18n.t('District')}
                                    />
                                </section>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    )
}

export default DashboardPage
