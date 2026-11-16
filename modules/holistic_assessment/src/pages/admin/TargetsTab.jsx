import i18n from '@dhis2/d2-i18n'
import {
    AlertBar,
    Button,
    CircularLoader,
    InputField,
    NoticeBox,
    SingleSelectField,
    SingleSelectOption,
    Tag,
} from '@dhis2/ui'
import React, { useMemo, useRef, useState } from 'react'
import {
    DEFAULT_FRAMEWORK_ID,
    DISTRICT_FRAMEWORK_ID,
    getFramework,
} from '../../framework/index.js'
import {
    isOverride,
    strippedOfDefaults,
    targetsFor,
    withTargets,
} from '../../framework/targets.js'
import { useTargets } from '../../lib/datastore.js'
import {
    assessmentYears,
    downloadText,
    stripBom,
    toCsv,
} from '../../lib/format.js'
import { ORG_LEVEL, scopeOf, useCurrentUser } from '../../lib/useCurrentUser.js'
import styles from '../AdminPage.module.css'

const TOOLS = [
    { id: DEFAULT_FRAMEWORK_ID, label: () => i18n.t('Regional tool') },
    { id: DISTRICT_FRAMEWORK_ID, label: () => i18n.t('District tool') },
]

const FIELDS = ['target', 'targetLower', 'targetUpper']

/** Blank means "no override": an empty box falls back to the shipped figure. */
const toStored = (text) => {
    const trimmed = String(text ?? '').trim()
    if (trimmed === '') {
        return undefined
    }
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : undefined
}

const asText = (value) =>
    value === null || value === undefined ? '' : String(value)

/**
 * The target each indicator is scored against for one year and one tool.
 *
 * A framework ships the targets its published workbook used. This tab records
 * what they are for a later year, and only the differences are stored, so a
 * target typed back to its shipped figure stops being an override and a
 * corrected framework in a later release still reaches that row.
 *
 * Editing belongs to national and regional users. A district administrator sees
 * the tab — the figures are what their assessment is scored against, and worth
 * being able to read and export — but cannot edit, because these targets apply
 * to every district on the tool, not to theirs alone. The handful of rows whose
 * target genuinely is set locally are flagged `targetVaries` and are edited on
 * the assessment itself.
 */
export const TargetsTab = () => {
    const user = useCurrentUser()
    const canEditTargets = scopeOf(user) <= ORG_LEVEL.REGIONAL

    const { value: store, save, loading } = useTargets()
    const [year, setYear] = useState(() => new Date().getFullYear() - 1)
    const [toolId, setToolId] = useState(DEFAULT_FRAMEWORK_ID)
    const [draft, setDraft] = useState(null)
    const [alert, setAlert] = useState(null)
    const fileRef = useRef(null)

    const framework = getFramework(toolId)
    const stored = useMemo(
        () => targetsFor(store, year, toolId),
        [store, year, toolId]
    )
    const current = draft ?? stored
    const dirty = draft !== null

    const indicators = useMemo(
        () => framework.objectives.flatMap((o) => o.indicators),
        [framework]
    )

    const overrideCount = useMemo(
        () => indicators.filter((i) => isOverride(i, current[i.code])).length,
        [indicators, current]
    )

    const notify = (message, tone = 'success') =>
        setAlert({ message, tone, id: Date.now() })

    const setField = (code, field, text) => {
        const next = { ...current }
        const row = { ...(next[code] || {}) }
        const value = toStored(text)
        if (value === undefined) {
            delete row[field]
        } else {
            row[field] = value
        }
        if (Object.keys(row).length) {
            next[code] = row
        } else {
            delete next[code]
        }
        setDraft(next)
    }

    const handleSave = async () => {
        try {
            const cleaned = strippedOfDefaults(framework, current)
            await save(withTargets(store, year, toolId, cleaned))
            setDraft(null)
            notify(i18n.t('Targets saved for {{year}}', { year }))
        } catch (e) {
            notify(e.message, 'critical')
        }
    }

    /* Last year's figures are the usual starting point for this year's. */
    const handleCopyPrevious = () => {
        const previous = targetsFor(store, year - 1, toolId)
        if (!Object.keys(previous).length) {
            notify(
                i18n.t('No targets are stored for {{year}}', {
                    year: year - 1,
                }),
                'critical'
            )
            return
        }
        setDraft({ ...previous })
        notify(
            i18n.t(
                'Copied {{count}} targets from {{year}}. Save to keep them.',
                {
                    count: Object.keys(previous).length,
                    year: year - 1,
                }
            )
        )
    }

    /* Reset drops every override, so the tool falls back to the workbook. */
    const handleReset = () => setDraft({})

    const handleExport = () => {
        const rows = [
            [
                i18n.t('Code'),
                i18n.t('Indicator'),
                i18n.t('Objective'),
                i18n.t('Direction'),
                i18n.t('Default target'),
                i18n.t('Default lower'),
                i18n.t('Default upper'),
                i18n.t('Target'),
                i18n.t('Lower'),
                i18n.t('Upper'),
            ],
            ...indicators.map((i) => {
                const row = current[i.code] || {}
                return [
                    i.code,
                    i.name,
                    i.objective,
                    i.direction,
                    asText(i.target),
                    asText(i.targetLower),
                    asText(i.targetUpper),
                    asText(row.target),
                    asText(row.targetLower),
                    asText(row.targetUpper),
                ]
            }),
        ]
        downloadText(
            `holistic-assessment-targets-${toolId}-${year}.csv`,
            toCsv(rows)
        )
    }

    /*
     * Import reads the same shape export writes, matching on the code column
     * and ignoring every other column — so a file that has been through Excel,
     * with its own column order or extra notes, still loads as long as the
     * headers it does carry are named the same.
     */
    const handleImport = async (file) => {
        try {
            const text = await file.text()
            const lines = stripBom(text)
                .split(/\r?\n/)
                .filter((l) => l.trim() !== '')
            if (lines.length < 2) {
                notify(i18n.t('That file has no rows'), 'critical')
                return
            }
            const split = (line) =>
                line
                    .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
                    .slice(0, -1)
                    .map((c) =>
                        c
                            .replace(/,$/, '')
                            .replace(/^"|"$/g, '')
                            .replace(/""/g, '"')
                            .trim()
                    )
            const header = split(lines[0]).map((h) => h.toLowerCase())
            const codeAt = header.indexOf(i18n.t('Code').toLowerCase())
            if (codeAt < 0) {
                notify(i18n.t('That file has no Code column'), 'critical')
                return
            }
            const at = {
                target: header.indexOf(i18n.t('Target').toLowerCase()),
                targetLower: header.indexOf(i18n.t('Lower').toLowerCase()),
                targetUpper: header.indexOf(i18n.t('Upper').toLowerCase()),
            }
            const known = new Set(indicators.map((i) => i.code))
            const next = {}
            let matched = 0
            let skipped = 0
            lines.slice(1).forEach((line) => {
                const cells = split(line)
                const code = cells[codeAt]
                if (!known.has(code)) {
                    skipped += 1
                    return
                }
                const row = {}
                FIELDS.forEach((field) => {
                    const idx = at[field]
                    if (idx >= 0) {
                        const value = toStored(cells[idx])
                        if (value !== undefined) {
                            row[field] = value
                        }
                    }
                })
                if (Object.keys(row).length) {
                    next[code] = row
                }
                matched += 1
            })
            setDraft(next)
            notify(
                i18n.t(
                    '{{matched}} rows read, {{skipped}} ignored. Review and save.',
                    { matched, skipped }
                )
            )
        } catch (e) {
            notify(e.message, 'critical')
        }
    }

    if (loading) {
        return (
            <div className={styles.loading}>
                <CircularLoader />
            </div>
        )
    }

    return (
        <section>
            {alert && (
                <AlertBar
                    key={alert.id}
                    duration={6000}
                    success={alert.tone === 'success'}
                    critical={alert.tone === 'critical'}
                    onHidden={() => setAlert(null)}
                >
                    {alert.message}
                </AlertBar>
            )}

            <h2 className={styles.sectionTitle}>{i18n.t('Targets')}</h2>

            <div className={styles.formRow}>
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Assessment year')}
                        selected={String(year)}
                        onChange={({ selected }) => {
                            setYear(Number(selected))
                            setDraft(null)
                        }}
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
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Tool')}
                        selected={toolId}
                        onChange={({ selected }) => {
                            setToolId(selected)
                            setDraft(null)
                        }}
                    >
                        {TOOLS.map((t) => (
                            <SingleSelectOption
                                key={t.id}
                                label={t.label()}
                                value={t.id}
                            />
                        ))}
                    </SingleSelectField>
                </div>
            </div>

            <div className={styles.tabHeader}>
                <Tag>
                    {i18n.t('{{count}} of {{total}} rows overridden', {
                        count: overrideCount,
                        total: indicators.length,
                    })}
                </Tag>
                {canEditTargets && (
                    <>
                        <Button
                            small
                            primary
                            disabled={!dirty}
                            onClick={handleSave}
                        >
                            {i18n.t('Save targets')}
                        </Button>
                        {dirty && (
                            <Button
                                small
                                secondary
                                onClick={() => setDraft(null)}
                            >
                                {i18n.t('Discard changes')}
                            </Button>
                        )}
                        <Button small onClick={handleCopyPrevious}>
                            {i18n.t('Copy from {{year}}', { year: year - 1 })}
                        </Button>
                        <Button small onClick={handleReset}>
                            {i18n.t('Reset to defaults')}
                        </Button>
                        <Button small onClick={() => fileRef.current?.click()}>
                            {i18n.t('Import CSV')}
                        </Button>
                    </>
                )}
                <Button small onClick={handleExport}>
                    {i18n.t('Export CSV')}
                </Button>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                            handleImport(file)
                        }
                        e.target.value = ''
                    }}
                />
            </div>

            {!canEditTargets && (
                <NoticeBox title={i18n.t('Read-only at district level')}>
                    {i18n.t(
                        'These targets apply to every district on the tool, so they are set nationally or regionally. Rows whose target is genuinely set locally are marked "varies" below and are edited on the assessment itself.'
                    )}
                </NoticeBox>
            )}

            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>{i18n.t('Code')}</th>
                            <th>{i18n.t('Indicator')}</th>
                            <th>{i18n.t('Direction')}</th>
                            <th>{i18n.t('Default')}</th>
                            <th>{i18n.t('Target')}</th>
                            <th>{i18n.t('Lower')}</th>
                            <th>{i18n.t('Upper')}</th>
                            <th>{i18n.t('Overridden')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {indicators.map((indicator) => {
                            const row = current[indicator.code] || {}
                            const overridden = isOverride(indicator, row)
                            return (
                                <tr
                                    key={indicator.code}
                                    data-objective={indicator.objective}
                                >
                                    <td>{indicator.code}</td>
                                    <td>
                                        {indicator.name}
                                        {indicator.targetVaries && (
                                            <span className={styles.hint}>
                                                {' '}
                                                {i18n.t('varies')}
                                            </span>
                                        )}
                                    </td>
                                    <td>{indicator.direction}</td>
                                    <td className={styles.numeric}>
                                        {indicator.targetLower !== null &&
                                        indicator.targetUpper !== null
                                            ? `${indicator.targetLower} – ${indicator.targetUpper}`
                                            : asText(indicator.target) || '—'}
                                    </td>
                                    {FIELDS.map((field) => (
                                        <td key={field}>
                                            <InputField
                                                dense
                                                type="number"
                                                disabled={!canEditTargets}
                                                value={asText(row[field])}
                                                placeholder={asText(
                                                    indicator[field]
                                                )}
                                                onChange={({ value }) =>
                                                    setField(
                                                        indicator.code,
                                                        field,
                                                        value
                                                    )
                                                }
                                            />
                                        </td>
                                    ))}
                                    <td className={styles.overrideCell}>
                                        {overridden && (
                                            <Tag positive>{i18n.t('Set')}</Tag>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    )
}

export default TargetsTab
