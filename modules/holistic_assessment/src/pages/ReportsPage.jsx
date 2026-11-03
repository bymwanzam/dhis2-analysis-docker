import i18n from '@dhis2/d2-i18n'
import {
    Button,
    CircularLoader,
    NoticeBox,
    SingleSelectField,
    SingleSelectOption,
} from '@dhis2/ui'
import PropTypes from 'prop-types'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    DEFAULT_FRAMEWORK_ID,
    allIndicators,
    getFramework,
} from '../framework/index.js'
import { LEVEL } from '../lib/constants.js'
import { useAssessmentKeys, useDataStore } from '../lib/datastore.js'
import { assessmentYears } from '../lib/format.js'
import { scoreAssessment } from '../lib/scoring.js'
import { useScoringFramework } from '../lib/useScoringFramework.js'
import { REPORTS, reportById } from '../reports/builders.js'
import {
    exportCsv,
    exportPdf,
    exportXlsx,
    printReport,
} from '../reports/export.js'
import styles from './ReportsPage.module.css'

/** One section of a built report: a heading, a table, and any note under it. */
const Section = ({ section }) => (
    <section className={styles.reportSection}>
        {section.heading && (
            <h3 className={styles.sectionHeading}>{section.heading}</h3>
        )}
        <div className={styles.tableWrapper}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        {section.columns.map((c) => (
                            <th
                                key={c.key}
                                className={
                                    c.numeric ? styles.numeric : undefined
                                }
                            >
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {section.rows.map((row, i) => (
                        <tr key={i}>
                            {section.columns.map((c) => (
                                <td
                                    key={c.key}
                                    className={
                                        c.numeric ? styles.numeric : undefined
                                    }
                                >
                                    {row[c.key] ?? '—'}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        {section.note && <p className={styles.note}>{section.note}</p>}
    </section>
)

Section.propTypes = {
    section: PropTypes.shape({
        columns: PropTypes.array.isRequired,
        heading: PropTypes.string,
        note: PropTypes.string,
        rows: PropTypes.array.isRequired,
    }).isRequired,
}

/**
 * Seven reports over the assessments stored for a year, and four ways of taking
 * one away with you.
 *
 * Every report is built from records already in the datastore — the same ones
 * the dashboard reads — so no report makes an analytics call and two reports of
 * the same year cannot disagree about a figure.
 *
 * The page holds no export code. A report is built into the shared model in
 * `reports/builders.js`, and the exporters in `reports/export.js` work from that
 * model alone, so each new report arrives with CSV, Excel, PDF and print already
 * working.
 */
export const ReportsPage = () => {
    const store = useDataStore()
    const { keys, loading: keysLoading } = useAssessmentKeys()

    const [year, setYear] = useState(() => new Date().getFullYear() - 1)
    const [reportId, setReportId] = useState(REPORTS[0].id)
    const [objectiveIndex, setObjectiveIndex] = useState(1)
    const [indicatorCode, setIndicatorCode] = useState('1.1')
    const [regionId, setRegionId] = useState('')
    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [exporting, setExporting] = useState(null)

    const { resolve: resolveFramework } = useScoringFramework(year)

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

    /* The regions that have an assessment, for the District Performance filter. */
    const regions = useMemo(
        () =>
            [
                ...new Map(
                    scored
                        .filter((s) => s.record.level === LEVEL.DISTRICT)
                        .map((s) => [
                            s.record.orgUnit?.parentId,
                            s.record.orgUnit?.parentName,
                        ])
                        .filter(([id]) => id)
                ).entries(),
            ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
        [scored]
    )

    const indicators = useMemo(
        () => allIndicators(getFramework(DEFAULT_FRAMEWORK_ID)),
        []
    )

    const definition = reportById(reportId)

    const built = useMemo(
        () =>
            definition.build({
                scored,
                year,
                objectiveIndex,
                indicatorCode,
                regionId: regionId || null,
            }),
        [definition, scored, year, objectiveIndex, indicatorCode, regionId]
    )

    const runExport = async (kind, fn) => {
        setExporting(kind)
        try {
            await fn(built)
        } catch (e) {
            setError(e)
        } finally {
            setExporting(null)
        }
    }

    const busy = keysLoading || loading

    return (
        <div>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    {i18n.t('Reports & Analytics')}
                </h1>
                <p className={styles.subtitle}>
                    {i18n.t(
                        'Seven reports over the assessments stored for a year. Every figure is read from the datastore, not from analytics.'
                    )}
                </p>
            </header>

            {/* Controls and the report picker are chrome: the print stylesheet
                hides them, so what prints is the report itself. */}
            <div className={styles.controls} data-print="hide">
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Assessment year')}
                        selected={String(year)}
                        onChange={({ selected }) => setYear(Number(selected))}
                    >
                        {assessmentYears().map((y) => (
                            <SingleSelectOption
                                key={y}
                                label={String(y)}
                                value={String(y)}
                            />
                        ))}
                    </SingleSelectField>
                </div>

                <div className={styles.grow}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Report')}
                        selected={reportId}
                        onChange={({ selected }) => setReportId(selected)}
                    >
                        {REPORTS.map((r) => (
                            <SingleSelectOption
                                key={r.id}
                                label={r.name()}
                                value={r.id}
                            />
                        ))}
                    </SingleSelectField>
                </div>

                {definition.needs === 'objective' && (
                    <div className={styles.field}>
                        <SingleSelectField
                            dense
                            label={i18n.t('Objective')}
                            selected={String(objectiveIndex)}
                            onChange={({ selected }) =>
                                setObjectiveIndex(Number(selected))
                            }
                        >
                            {[1, 2, 3].map((n) => (
                                <SingleSelectOption
                                    key={n}
                                    label={i18n.t('Objective {{n}}', { n })}
                                    value={String(n)}
                                />
                            ))}
                        </SingleSelectField>
                    </div>
                )}

                {definition.needs === 'indicator' && (
                    <div className={styles.grow}>
                        <SingleSelectField
                            dense
                            filterable
                            label={i18n.t('Indicator')}
                            selected={indicatorCode}
                            onChange={({ selected }) =>
                                setIndicatorCode(selected)
                            }
                        >
                            {indicators.map((ind) => (
                                <SingleSelectOption
                                    key={ind.code}
                                    label={`${ind.code} — ${ind.name}`}
                                    value={ind.code}
                                />
                            ))}
                        </SingleSelectField>
                    </div>
                )}

                {definition.needs === 'region' && (
                    <div className={styles.field}>
                        <SingleSelectField
                            dense
                            label={i18n.t('Region')}
                            selected={regionId}
                            onChange={({ selected }) => setRegionId(selected)}
                        >
                            <SingleSelectOption
                                label={i18n.t('All regions')}
                                value=""
                            />
                            {regions.map(([id, label]) => (
                                <SingleSelectOption
                                    key={id}
                                    label={label || id}
                                    value={id}
                                />
                            ))}
                        </SingleSelectField>
                    </div>
                )}
            </div>

            <p className={styles.reportDescription} data-print="hide">
                {definition.description()}
            </p>

            {error && (
                <NoticeBox error title={i18n.t('Something went wrong')}>
                    {error.message}
                </NoticeBox>
            )}

            {busy ? (
                <div className={styles.loading}>
                    <CircularLoader />
                </div>
            ) : !records.length ? (
                <NoticeBox
                    title={i18n.t('No assessments for {{year}}', { year })}
                >
                    {i18n.t(
                        'Nothing has been stored for this year yet, so there is nothing to report on.'
                    )}
                </NoticeBox>
            ) : (
                <>
                    <div className={styles.exportBar} data-print="hide">
                        <Button
                            small
                            onClick={() => runExport('pdf', exportPdf)}
                            loading={exporting === 'pdf'}
                        >
                            {i18n.t('Export PDF')}
                        </Button>
                        <Button
                            small
                            onClick={() => runExport('xlsx', exportXlsx)}
                            loading={exporting === 'xlsx'}
                        >
                            {i18n.t('Export Excel')}
                        </Button>
                        <Button
                            small
                            onClick={() => runExport('csv', exportCsv)}
                            loading={exporting === 'csv'}
                        >
                            {i18n.t('Export CSV')}
                        </Button>
                        <Button small onClick={printReport}>
                            {i18n.t('Print')}
                        </Button>
                    </div>

                    <article className={styles.report}>
                        <div className={styles.reportBanner}>
                            <h2 className={styles.reportTitle}>
                                {built.title}
                            </h2>
                            {built.subtitle && (
                                <p className={styles.reportSubtitle}>
                                    {built.subtitle}
                                </p>
                            )}
                        </div>
                        {built.meta.length > 0 && (
                            <p className={styles.reportMeta}>
                                {built.meta.join(' · ')}
                            </p>
                        )}
                        {built.sections.map((sec, i) => (
                            <Section key={i} section={sec} />
                        ))}
                    </article>
                </>
            )}
        </div>
    )
}

export default ReportsPage
