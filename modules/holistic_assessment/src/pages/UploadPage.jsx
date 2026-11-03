import i18n from '@dhis2/d2-i18n'
import {
    AlertBar,
    Button,
    Checkbox,
    CircularLoader,
    IconDownload24,
    IconUpload24,
    NoticeBox,
    SegmentedControl,
} from '@dhis2/ui'
import cx from 'classnames'
import PropTypes from 'prop-types'
import React, { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ContextBar from '../components/ContextBar.jsx'
import StatusTag from '../components/StatusTag.jsx'
import { useAppState } from '../lib/AppState.jsx'
import {
    LEVEL,
    MILESTONE_STATUS_LABEL,
    PERIOD_STATUS,
    PERIOD_STATUS_LABEL,
} from '../lib/constants.js'
import { isConflict, usePeriods } from '../lib/datastore.js'
import { fmtNumber } from '../lib/format.js'
import {
    CHANGE,
    applyUpload,
    compareUpload,
    parseUpload,
    readWorkbook,
} from '../lib/upload.js'
import { downloadTemplate, loadWorkbookFile } from '../lib/uploadTemplate.js'
import { useAssessment } from '../lib/useAssessment.js'
import { ownsOrgUnit, useCurrentUser } from '../lib/useCurrentUser.js'
import {
    useDistrictsForRegion,
    useOrgUnitsForLevel,
} from '../lib/useOrgUnits.js'
import { canEditIndicator, isOwnerEditable, periodOf } from '../lib/workflow.js'
import styles from './UploadPage.module.css'

const MAX_BYTES = 10 * 1024 * 1024

const CHANGE_LABEL = {
    [CHANGE.NEW]: () => i18n.t('New'),
    [CHANGE.CHANGED]: () => i18n.t('Changed'),
    [CHANGE.SAME]: () => i18n.t('Unchanged'),
    [CHANGE.LOCKED]: () => i18n.t('Locked'),
}

const show = (v) => (v === null || v === undefined || v === '' ? '—' : fmtNumber(Number(v), 4))

/** Old → new for one field, or just the value when it did not change. */
const Delta = ({ row, field }) => {
    if (!(field in row.after)) {
        return <span className={styles.muted}>{show(row.before[field])}</span>
    }
    const changed = row.fields.includes(field)
    if (!changed) {
        return <span>{show(row.after[field])}</span>
    }
    return (
        <span className={styles.delta}>
            <s className={styles.old}>{show(row.before[field])}</s>
            <span aria-hidden="true">→</span>
            <span className={styles.new}>{show(row.after[field])}</span>
        </span>
    )
}

Delta.propTypes = {
    field: PropTypes.string.isRequired,
    row: PropTypes.object.isRequired,
}

/**
 * Local upload: fill an assessment from an Excel workbook laid out like the
 * form, with the previous and current year side by side.
 *
 * Download the template, fill it in (offline, or in a meeting, or from local
 * records), upload it, look over every change, then apply. The save goes
 * through the same server checks as typing into the form.
 */
export const UploadPage = () => {
    const { year, setYear, regionId, setRegionId, districtId, setDistrictId } =
        useAppState()
    const navigate = useNavigate()
    const user = useCurrentUser()
    const [level, setLevel] = useState(LEVEL.REGION)

    const { orgUnits: regions } = useOrgUnitsForLevel(LEVEL.REGION)
    const { districts } = useDistrictsForRegion(regionId)
    const selectedId = level === LEVEL.DISTRICT ? districtId : regionId
    const orgUnit = useMemo(() => {
        const pool = level === LEVEL.DISTRICT ? districts : regions
        return pool.find((o) => o.id === selectedId) || null
    }, [level, districts, regions, selectedId])

    const { assessment, framework, loading, error, saveNow, reload } =
        useAssessment({ year, orgUnit, level, autoSave: false })

    const { value: periods } = usePeriods()
    const period = periodOf(periods, year)
    const owns = Boolean(orgUnit) && ownsOrgUnit(user, orgUnit)
    const canAct = user.canEdit && (user.isSuperuser || owns)
    const editable = Boolean(canAct && assessment && isOwnerEditable(assessment.status, period))

    const [file, setFile] = useState(null)
    const [parsed, setParsed] = useState(null)
    const [reading, setReading] = useState(false)
    const [readError, setReadError] = useState(null)
    const [dragging, setDragging] = useState(false)
    const [showSame, setShowSame] = useState(false)
    const [applying, setApplying] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const [alert, setAlert] = useState(null)
    const [applied, setApplied] = useState(null)
    const inputRef = useRef(null)

    const notify = (message, tone = 'success') => setAlert({ message, tone, id: Date.now() })

    const reset = () => {
        setFile(null)
        setParsed(null)
        setReadError(null)
        setApplied(null)
        if (inputRef.current) {
            inputRef.current.value = ''
        }
    }

    const comparison = useMemo(
        () =>
            parsed && assessment && framework
                ? compareUpload(assessment, parsed, {
                      framework,
                      canEdit: (code) => editable && canEditIndicator(assessment, code, period),
                  })
                : null,
        [parsed, assessment, framework, editable, period]
    )

    const toApply = comparison ? comparison.summary.new + comparison.summary.changed : 0

    const readFile = async (picked) => {
        reset()
        if (!picked) {
            return
        }
        setFile(picked)
        if (!/\.xlsx$/i.test(picked.name)) {
            setReadError(
                /\.(xls|csv|ods)$/i.test(picked.name)
                    ? i18n.t('Save the file as an Excel workbook (.xlsx) and upload it again.')
                    : i18n.t('Upload an Excel workbook (.xlsx).')
            )
            return
        }
        if (picked.size > MAX_BYTES) {
            setReadError(i18n.t('The file is larger than 10 MB. Use the template, which is far smaller.'))
            return
        }
        setReading(true)
        try {
            const wb = await loadWorkbookFile(picked)
            setParsed(
                parseUpload(readWorkbook(wb), {
                    framework,
                    year,
                    orgUnitId: orgUnit?.id,
                })
            )
        } catch (e) {
            setReadError(
                i18n.t('The file could not be read as an Excel workbook — {{msg}}', { msg: e.message })
            )
        } finally {
            setReading(false)
        }
    }

    const handleDownload = async () => {
        setDownloading(true)
        try {
            await downloadTemplate({ framework, year, level, orgUnit, assessment, user: user.user })
        } catch (e) {
            notify(e.message, 'critical')
        } finally {
            setDownloading(false)
        }
    }

    const handleApply = async () => {
        setApplying(true)
        try {
            const next = applyUpload(assessment, comparison, {
                fileName: file?.name,
                user: user.user,
            })
            await saveNow(next)
            setApplied({ count: toApply, name: orgUnit?.displayName })
            setParsed(null)
            setFile(null)
            notify(i18n.t('{{count}} change(s) saved to {{name}}', { count: toApply, name: orgUnit?.displayName }))
        } catch (e) {
            notify(
                isConflict(e)
                    ? i18n.t('Someone saved this assessment while you were reviewing the file. It has been reloaded — check the comparison and apply again.')
                    : e.message,
                'critical'
            )
            if (isConflict(e)) {
                reload()
            }
        } finally {
            setApplying(false)
        }
    }

    const onDrop = (e) => {
        e.preventDefault()
        setDragging(false)
        if (orgUnit) {
            readFile(e.dataTransfer.files?.[0])
        }
    }

    const visibleRows = comparison
        ? comparison.rows.filter((r) => showSame || r.change !== CHANGE.SAME)
        : []
    const visibleMilestones = comparison
        ? comparison.milestoneRows.filter((r) => showSame || r.change !== CHANGE.SAME)
        : []
    const blocking = parsed?.problems.filter((p) => p.blocking) || []
    const warnings = parsed?.problems.filter((p) => !p.blocking) || []

    return (
        <div>
            {alert && (
                <AlertBar
                    key={alert.id}
                    duration={8000}
                    success={alert.tone === 'success'}
                    critical={alert.tone === 'critical'}
                    onHidden={() => setAlert(null)}
                >
                    {alert.message}
                </AlertBar>
            )}

            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>{i18n.t('Local Upload')}</h1>
                    <p className={styles.subtitle}>
                        {i18n.t(
                            'Fill an assessment from an Excel workbook laid out like the form, with the previous and current year side by side.'
                        )}
                    </p>
                </div>
                <SegmentedControl
                    options={[
                        { label: i18n.t('Regional'), value: LEVEL.REGION },
                        { label: i18n.t('District'), value: LEVEL.DISTRICT },
                    ]}
                    selected={level}
                    onChange={({ value }) => {
                        setLevel(value)
                        reset()
                    }}
                />
            </header>

            <ContextBar
                level={level}
                year={year}
                regionId={regionId}
                districtId={districtId}
                onYearChange={(y) => {
                    setYear(y)
                    reset()
                }}
                onRegionChange={(id) => {
                    setRegionId(id)
                    setDistrictId('')
                    reset()
                }}
                onDistrictChange={(id) => {
                    setDistrictId(id)
                    reset()
                }}
            >
                {assessment && <StatusTag status={assessment.status} />}
            </ContextBar>

            {!orgUnit && (
                <NoticeBox title={i18n.t('Choose where the figures belong')}>
                    {level === LEVEL.DISTRICT
                        ? i18n.t('Choose a year, a region and a district to begin.')
                        : i18n.t('Choose a year and a region to begin.')}
                </NoticeBox>
            )}

            {orgUnit && loading && (
                <div className={styles.loading}>
                    <CircularLoader small />
                </div>
            )}

            {orgUnit && error && (
                <NoticeBox error title={i18n.t('Could not load the assessment')}>
                    {error.message}
                </NoticeBox>
            )}

            {orgUnit && assessment && !loading && (
                <>
                    {!canAct && (
                        <NoticeBox className={styles.notice} title={i18n.t('You can download, but not upload, for {{name}}', { name: orgUnit.displayName })}>
                            {user.canEdit
                                ? i18n.t('Only staff of {{name}} (or its region) can enter its data.', { name: orgUnit.displayName })
                                : i18n.t('Uploading needs the GHS_ASSESSMENT_EDIT permission.')}
                        </NoticeBox>
                    )}
                    {canAct && !editable && (
                        <NoticeBox warning className={styles.notice} title={i18n.t('This assessment is not open for editing')}>
                            {period.status !== PERIOD_STATUS.OPEN && period.status !== PERIOD_STATUS.CLOSED
                                ? i18n.t('The {{year}} period is {{status}}.', { year, status: PERIOD_STATUS_LABEL[period.status] })
                                : i18n.t('It has been submitted. A file can be compared, but not applied, until it is returned for revision.')}
                        </NoticeBox>
                    )}

                    <ol className={styles.steps}>
                        <li className={styles.step}>
                            <span className={styles.stepNumber}>1</span>
                            <div className={styles.stepBody}>
                                <h2 className={styles.stepTitle}>{i18n.t('Download the template')}</h2>
                                <p className={styles.stepText}>
                                    {i18n.t(
                                        'The form for {{name}}, {{year}}, as a workbook — every indicator with {{prev}} and {{year}} side by side, the change between them worked out for you, and the milestones. Figures already saved are filled in.',
                                        { name: orgUnit.displayName, year, prev: year - 1 }
                                    )}
                                </p>
                                <Button
                                    icon={<IconDownload24 />}
                                    onClick={handleDownload}
                                    loading={downloading}
                                    disabled={downloading}
                                >
                                    {i18n.t('Download Excel template')}
                                </Button>
                            </div>
                        </li>
                        <li className={styles.step}>
                            <span className={styles.stepNumber}>2</span>
                            <div className={styles.stepBody}>
                                <h2 className={styles.stepTitle}>{i18n.t('Fill it in')}</h2>
                                <p className={styles.stepText}>
                                    {i18n.t(
                                        'Type figures into the yellow columns in the same units as the form, and choose each milestone’s status. Keep the Code column and the About sheet as they are.'
                                    )}
                                </p>
                            </div>
                        </li>
                        <li className={styles.step}>
                            <span className={styles.stepNumber}>3</span>
                            <div className={styles.stepBody}>
                                <h2 className={styles.stepTitle}>{i18n.t('Upload and check')}</h2>
                                <label
                                    className={cx(styles.drop, {
                                        [styles.dropActive]: dragging,
                                        [styles.dropHasFile]: Boolean(file),
                                    })}
                                    onDragOver={(e) => {
                                        e.preventDefault()
                                        setDragging(true)
                                    }}
                                    onDragLeave={() => setDragging(false)}
                                    onDrop={onDrop}
                                >
                                    <input
                                        ref={inputRef}
                                        type="file"
                                        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                        className={styles.fileInput}
                                        onChange={(e) => readFile(e.target.files?.[0])}
                                    />
                                    <span className={styles.dropIcon} aria-hidden="true">
                                        <IconUpload24 color="currentColor" />
                                    </span>
                                    <span className={styles.dropTitle}>
                                        {file ? file.name : i18n.t('Drop the workbook here, or click to choose it')}
                                    </span>
                                    <span className={styles.dropHint}>
                                        {file
                                            ? i18n.t('Choose another file to replace it')
                                            : i18n.t('Excel workbook (.xlsx), up to 10 MB. Nothing is saved until you apply it.')}
                                    </span>
                                </label>
                            </div>
                        </li>
                    </ol>

                    {applied && (
                        <NoticeBox valid className={styles.notice} title={i18n.t('Upload applied')}>
                            {i18n.t('{{count}} change(s) were saved to {{name}}.', applied)}{' '}
                            <Button small onClick={() => navigate(level === LEVEL.DISTRICT ? '/district' : '/regional')}>
                                {i18n.t('Open the assessment')}
                            </Button>
                        </NoticeBox>
                    )}

                    {reading && (
                        <div className={styles.loading}>
                            <CircularLoader small />
                            <span>{i18n.t('Reading the workbook…')}</span>
                        </div>
                    )}

                    {readError && (
                        <NoticeBox error className={styles.notice} title={i18n.t('This file cannot be used')}>
                            {readError}
                        </NoticeBox>
                    )}

                    {blocking.length > 0 && (
                        <NoticeBox error className={styles.notice} title={i18n.t('This file cannot be applied')}>
                            <ul className={styles.problemList}>
                                {blocking.map((p) => (
                                    <li key={p.message}>{p.message}</li>
                                ))}
                            </ul>
                        </NoticeBox>
                    )}

                    {comparison && !parsed.blocked && (
                        <section className={styles.review} aria-labelledby="review-title">
                            <div className={styles.reviewHead}>
                                <h2 id="review-title" className={styles.reviewTitle}>
                                    {i18n.t('What this file would change')}
                                </h2>
                                <div className={styles.chips}>
                                    <span className={styles.chip} data-change="NEW">
                                        <strong>{comparison.summary.new}</strong> {i18n.t('new')}
                                    </span>
                                    <span className={styles.chip} data-change="CHANGED">
                                        <strong>{comparison.summary.changed}</strong> {i18n.t('changed')}
                                    </span>
                                    <span className={styles.chip} data-change="SAME">
                                        <strong>{comparison.summary.same}</strong> {i18n.t('unchanged')}
                                    </span>
                                    {comparison.summary.locked > 0 && (
                                        <span className={styles.chip} data-change="LOCKED">
                                            <strong>{comparison.summary.locked}</strong> {i18n.t('locked')}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {warnings.length > 0 && (
                                <NoticeBox warning className={styles.notice} title={i18n.t('{{count}} row(s) were skipped', { count: warnings.length })}>
                                    <ul className={styles.problemList}>
                                        {warnings.slice(0, 12).map((p) => (
                                            <li key={p.message}>{p.message}</li>
                                        ))}
                                        {warnings.length > 12 && (
                                            <li>{i18n.t('…and {{count}} more', { count: warnings.length - 12 })}</li>
                                        )}
                                    </ul>
                                </NoticeBox>
                            )}

                            <Checkbox
                                className={styles.toggle}
                                label={i18n.t('Show unchanged rows too')}
                                checked={showSame}
                                onChange={({ checked }) => setShowSame(checked)}
                            />

                            {visibleRows.length === 0 && visibleMilestones.length === 0 ? (
                                <p className={styles.empty}>
                                    {i18n.t('The file matches what is already saved — there is nothing to apply.')}
                                </p>
                            ) : (
                                <div className={styles.tableWrap}>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th scope="col">{i18n.t('Code')}</th>
                                                <th scope="col">{i18n.t('Indicator')}</th>
                                                <th scope="col" className={styles.num}>{year - 1}</th>
                                                <th scope="col" className={styles.num}>{year}</th>
                                                <th scope="col">{i18n.t('Result')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleRows.map((r) => (
                                                <tr key={r.code} data-change={r.change}>
                                                    <th scope="row" className={styles.code}>{r.code}</th>
                                                    <td className={styles.name}>
                                                        {r.name}
                                                        {r.replacesDhis2 && (
                                                            <span className={styles.note}>{i18n.t('replaces a figure fetched from DHIS2')}</span>
                                                        )}
                                                        {'target' in r.after && r.fields.includes('target') && (
                                                            <span className={styles.note}>
                                                                {i18n.t('local target {{from}} → {{to}}', { from: show(r.before.target), to: show(r.after.target) })}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className={styles.num}><Delta row={r} field="previous" /></td>
                                                    <td className={styles.num}><Delta row={r} field="current" /></td>
                                                    <td>
                                                        <span className={styles.badge} data-change={r.change}>
                                                            {CHANGE_LABEL[r.change]()}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {visibleMilestones.map((r) => (
                                                <tr key={r.code} data-change={r.change}>
                                                    <th scope="row" className={styles.code}>{r.code}</th>
                                                    <td className={styles.name}>
                                                        {r.name}
                                                        {r.after.evidence && (
                                                            <span className={styles.note}>{r.after.evidence}</span>
                                                        )}
                                                    </td>
                                                    <td className={styles.num} colSpan={2}>
                                                        {r.change === CHANGE.SAME ? (
                                                            MILESTONE_STATUS_LABEL[r.after.status] || '—'
                                                        ) : (
                                                            <span className={styles.delta}>
                                                                <s className={styles.old}>{MILESTONE_STATUS_LABEL[r.before.status] || '—'}</s>
                                                                <span aria-hidden="true">→</span>
                                                                <span className={styles.new}>{MILESTONE_STATUS_LABEL[r.after.status] || '—'}</span>
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span className={styles.badge} data-change={r.change}>
                                                            {CHANGE_LABEL[r.change]()}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {comparison.summary.locked > 0 && (
                                <p className={styles.lockedNote}>
                                    {editable
                                        ? i18n.t('Locked rows are not among the indicators the reviewer flagged, so they cannot change during a revision.')
                                        : i18n.t('Nothing can be applied while the assessment is not open for editing.')}
                                </p>
                            )}

                            <div className={styles.actions}>
                                <Button secondary onClick={reset} disabled={applying}>
                                    {i18n.t('Cancel')}
                                </Button>
                                <Button
                                    primary
                                    onClick={handleApply}
                                    loading={applying}
                                    disabled={applying || !editable || toApply === 0}
                                >
                                    {toApply
                                        ? i18n.t('Apply {{count}} change(s) to {{name}}', { count: toApply, name: orgUnit.displayName })
                                        : i18n.t('Nothing to apply')}
                                </Button>
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    )
}

export default UploadPage
