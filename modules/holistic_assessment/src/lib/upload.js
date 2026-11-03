import i18n from '@dhis2/d2-i18n'
import { allIndicators, allMilestones } from '../framework/index.js'
import { MILESTONE_STATUS, MILESTONE_STATUS_LABEL } from './constants.js'
import { withHistory } from './datastore.js'

/**
 * Local upload: filling an assessment from an Excel workbook laid out like the
 * form — one row per indicator, the previous and current year side by side,
 * and a sheet of milestones.
 *
 * Everything here works on plain data (`{ name, rows: [[value, ...]] }` per
 * sheet), so it can be tested without a spreadsheet library; `readWorkbook`
 * turns an ExcelJS workbook into that shape.
 *
 * Nothing is saved from here. `compareUpload` says what a file would change and
 * `applyUpload` builds the new record; the page shows the comparison first and
 * the server checks the save like any other.
 */

/* ------------------------------------------------------------ cell values */

/** The value an ExcelJS cell holds, flattened to a string, number or null. */
export const cellValue = (v) => {
    if (v === null || v === undefined) {
        return null
    }
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
        return v
    }
    if (v instanceof Date) {
        return v.toISOString()
    }
    if (typeof v === 'object') {
        if ('result' in v) {
            return cellValue(v.result) // formula
        }
        if (Array.isArray(v.richText)) {
            return v.richText.map((r) => r.text).join('')
        }
        if ('text' in v) {
            return cellValue(v.text) // hyperlink
        }
        if ('error' in v) {
            return null
        }
    }
    return null
}

const BLANKS = new Set(['', '-', '—', 'n/a', 'na', 'nil', 'none', 'null'])

/**
 * A cell read as a number. Accepts what people type into spreadsheets:
 * "1,234.5", "85%" (read as 0.85, as Excel itself would), surrounding spaces.
 * Returns `{ value }`, `{ blank: true }` or `{ invalid: text }`.
 */
export const readNumber = (raw) => {
    const v = cellValue(raw)
    if (v === null) {
        return { blank: true }
    }
    if (typeof v === 'number') {
        return Number.isFinite(v) ? { value: v } : { invalid: String(v) }
    }
    const text = String(v).trim()
    if (BLANKS.has(text.toLowerCase())) {
        return { blank: true }
    }
    const percent = text.endsWith('%')
    const n = Number(text.replace(/%$/, '').replace(/,/g, '').trim())
    if (!Number.isFinite(n) || text.replace(/%$/, '').trim() === '') {
        return { invalid: text }
    }
    return { value: percent ? n / 100 : n }
}

const norm = (s) =>
    String(s ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, ' ')
        .trim()

/* ------------------------------------------------------------- workbooks */

/** An ExcelJS workbook as plain sheets of plain values. */
export const readWorkbook = (workbook) =>
    workbook.worksheets.map((ws) => {
        const rows = []
        ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            const values = []
            row.eachCell({ includeEmpty: true }, (cell, col) => {
                values[col - 1] = cellValue(cell.value)
            })
            rows[rowNumber - 1] = values
        })
        return { name: ws.name, rows: Array.from(rows, (r) => r || []) }
    })

/** The first row, within the first 30, that has a cell matching `test`. */
const findHeader = (sheet, test) => {
    const limit = Math.min(sheet.rows.length, 30)
    for (let r = 0; r < limit; r++) {
        if ((sheet.rows[r] || []).some((c) => typeof c === 'string' && test(norm(c)))) {
            return r
        }
    }
    return -1
}

const isCodeHeader = (h) =>
    /^(indicator )?code$/.test(h) || h === 'no' || h === 'no.' || h === 's n'

/**
 * Which column holds what, read from the header row. Year columns are found by
 * the year itself ("2024", "2024 (previous year)") or, failing that, by the
 * words previous / current.
 */
export const locateColumns = (header, year) => {
    const cols = {}
    const prev = String(year - 1)
    const cur = String(year)
    header.forEach((cell, i) => {
        const h = norm(cell)
        if (!h) {
            return
        }
        if (cols.code === undefined && isCodeHeader(h)) {
            cols.code = i
        } else if (cols.name === undefined && /^(indicator|indicator name|name|milestone)$/.test(h)) {
            cols.name = i
        } else if (cols.previous === undefined && (h.split(' ').includes(prev) || /\b(previous|baseline|last year)\b/.test(h))) {
            cols.previous = i
        } else if (cols.current === undefined && (h.split(' ').includes(cur) || /\b(current|this year|actual)\b/.test(h))) {
            cols.current = i
        } else if (cols.target === undefined && /\b(local )?target\b/.test(h)) {
            cols.target = i
        } else if (cols.status === undefined && /\bstatus\b/.test(h)) {
            cols.status = i
        } else if (cols.evidence === undefined && /\b(evidence|comment|comments|remarks)\b/.test(h)) {
            cols.evidence = i
        }
    })
    return cols
}

/** The template's "About" sheet, as key → value. */
const readAbout = (sheets) => {
    const about = sheets.find((s) => norm(s.name) === 'about')
    if (!about) {
        return null
    }
    const meta = {}
    about.rows.forEach((row) => {
        const key = norm(row?.[0])
        if (key) {
            meta[key] = row[1] === null || row[1] === undefined ? '' : String(row[1]).trim()
        }
    })
    return meta
}

const STATUS_BY_TEXT = Object.fromEntries(
    Object.values(MILESTONE_STATUS).flatMap((s) => [
        [norm(s), s],
        [norm(s.replace(/_/g, ' ')), s],
        [norm(MILESTONE_STATUS_LABEL[s]), s],
    ])
)

/**
 * Resolve a code cell to a framework code. Excel turns "1.10" typed into a
 * number cell into 1.1, which would then collide with indicator 1.1 — so a
 * numeric code that could be either is settled by the name beside it.
 */
const resolveCode = (raw, name, byCode) => {
    if (raw === null || raw === undefined || raw === '') {
        return { code: null }
    }
    const text = String(raw).trim()
    if (byCode.has(text)) {
        if (typeof raw !== 'number') {
            return { code: text }
        }
    }
    if (typeof raw === 'number') {
        const candidates = [...byCode.keys()].filter((c) => Number(c) === raw)
        if (candidates.length === 1) {
            return { code: candidates[0] }
        }
        if (candidates.length > 1) {
            const n = norm(name)
            const match = candidates.find((c) => n && norm(byCode.get(c).name) === n)
            return match ? { code: match } : { ambiguous: candidates }
        }
    }
    return { unknown: text }
}

/**
 * Read an uploaded workbook against a framework and year.
 *
 * Returns the figures found, per code, and a list of problems. Problems with
 * `blocking: true` mean the file cannot be applied at all (wrong year, wrong
 * org unit, no indicator sheet); the rest are per-row and only skip that row.
 */
export const parseUpload = (sheets, { framework, year, orgUnitId }) => {
    const problems = []
    const block = (message) => problems.push({ blocking: true, message })
    const indicators = {}
    const milestones = {}

    const about = readAbout(sheets)
    if (about) {
        if (about['framework'] && about['framework'] !== framework.id) {
            block(
                i18n.t('This file is for the {{file}} tool, not {{wanted}}. Download the template for this level.', {
                    file: about['framework'],
                    wanted: framework.id,
                })
            )
        }
        if (about['year'] && Number(about['year']) !== Number(year)) {
            block(
                i18n.t('This file is for {{file}}, but {{year}} is selected.', {
                    file: about['year'],
                    year,
                })
            )
        }
        if (about['org unit id'] && orgUnitId && about['org unit id'] !== orgUnitId) {
            block(
                i18n.t('This file was made for {{name}}, not the organisation unit selected.', {
                    name: about['org unit'] || about['org unit id'],
                })
            )
        }
    }

    /* Indicators: the sheet whose header has a code column and a year column. */
    const byCode = new Map(allIndicators(framework).map((i) => [i.code, i]))
    let indicatorSheet = null
    let cols = null
    let headerRow = -1
    for (const sheet of sheets) {
        const r = findHeader(sheet, isCodeHeader)
        if (r < 0) {
            continue
        }
        const c = locateColumns(sheet.rows[r], year)
        if (c.code !== undefined && (c.current !== undefined || c.previous !== undefined)) {
            indicatorSheet = sheet
            cols = c
            headerRow = r
            break
        }
    }

    if (!indicatorSheet) {
        block(
            i18n.t(
                'No indicator sheet was found. It needs a Code column and columns headed {{prev}} and {{year}} (or Previous and Current).',
                { prev: year - 1, year }
            )
        )
    } else {
        if (cols.previous === undefined) {
            problems.push({
                message: i18n.t('No {{prev}} column was found, so previous-year values are left as they are.', {
                    prev: year - 1,
                }),
            })
        }
        if (cols.current === undefined) {
            problems.push({
                message: i18n.t('No {{year}} column was found, so current-year values are left as they are.', {
                    year,
                }),
            })
        }
        const seen = new Set()
        indicatorSheet.rows.slice(headerRow + 1).forEach((row, i) => {
            const rowNumber = headerRow + 2 + i
            const raw = row?.[cols.code]
            const name = cols.name !== undefined ? row?.[cols.name] : null
            const resolved = resolveCode(raw, name, byCode)
            if (!resolved.code) {
                if (resolved.unknown && /^\d+(\.\d+)+$/.test(resolved.unknown)) {
                    problems.push({
                        row: rowNumber,
                        message: i18n.t('Row {{row}} — code {{code}} is not in this tool, so it was skipped.', {
                            row: rowNumber,
                            code: resolved.unknown,
                        }),
                    })
                } else if (resolved.ambiguous) {
                    problems.push({
                        row: rowNumber,
                        message: i18n.t('Row {{row}} — the code could be {{codes}}. Format the Code column as text.', {
                            row: rowNumber,
                            codes: resolved.ambiguous.join(' or '),
                        }),
                    })
                }
                return // headings, blank lines and notes are not rows
            }
            const code = resolved.code
            if (seen.has(code)) {
                problems.push({
                    row: rowNumber,
                    code,
                    message: i18n.t('Row {{row}} — indicator {{code}} appears twice; only the first was used.', {
                        row: rowNumber,
                        code,
                    }),
                })
                return
            }
            seen.add(code)

            const entry = {}
            const read = (field, col) => {
                if (col === undefined) {
                    return
                }
                const n = readNumber(row?.[col])
                if (n.invalid !== undefined) {
                    problems.push({
                        row: rowNumber,
                        code,
                        message: i18n.t('Row {{row}} — {{code}} {{field}} "{{text}}" is not a number, so it was skipped.', {
                            row: rowNumber,
                            code,
                            field: field === 'current' ? year : field === 'previous' ? year - 1 : i18n.t('target'),
                            text: n.invalid,
                        }),
                    })
                } else {
                    entry[field] = n.blank ? null : n.value
                }
            }
            read('previous', cols.previous)
            read('current', cols.current)
            // Only targets that are set locally can be supplied; the rest are
            // the framework's and shown in the template for reference.
            if (byCode.get(code).targetVaries) {
                read('target', cols.target)
            }
            indicators[code] = entry
        })
    }

    /* Milestones: a sheet with a code column and a status column. */
    const msCodes = new Map(allMilestones(framework).map((m) => [m.code, m]))
    for (const sheet of sheets) {
        if (sheet === indicatorSheet) {
            continue
        }
        const r = findHeader(sheet, (h) => /\bstatus\b/.test(h))
        if (r < 0) {
            continue
        }
        const c = locateColumns(sheet.rows[r], year)
        if (c.code === undefined || c.status === undefined) {
            continue
        }
        sheet.rows.slice(r + 1).forEach((row, i) => {
            const code = String(row?.[c.code] ?? '').trim().toUpperCase()
            if (!msCodes.has(code)) {
                return
            }
            const statusText = norm(row?.[c.status])
            const status = statusText ? STATUS_BY_TEXT[statusText] : null
            if (statusText && !status) {
                problems.push({
                    row: r + 2 + i,
                    code,
                    message: i18n.t('{{code}} status "{{text}}" is not one of Achieved, In progress or Not achieved, so it was skipped.', {
                        code,
                        text: row[c.status],
                    }),
                })
                return
            }
            const entry = { status: status || null }
            if (c.evidence !== undefined) {
                const ev = cellValue(row?.[c.evidence])
                entry.evidence = ev === null ? '' : String(ev).trim()
            }
            milestones[code] = entry
        })
        break
    }

    return {
        indicators,
        milestones,
        about,
        problems,
        blocked: problems.some((p) => p.blocking),
        sheetName: indicatorSheet?.name || null,
    }
}

/* ------------------------------------------------------------- comparing */

export const CHANGE = {
    NEW: 'NEW',
    CHANGED: 'CHANGED',
    SAME: 'SAME',
    LOCKED: 'LOCKED',
}

const sameNumber = (a, b) =>
    (a === null || a === undefined || a === '' ? null : Number(a)) ===
    (b === null || b === undefined || b === '' ? null : Number(b))

/**
 * What applying `parsed` to `assessment` would do, row by row.
 * `canEdit(code)` says whether the record lets that indicator change now.
 */
export const compareUpload = (assessment, parsed, { framework, canEdit = () => true }) => {
    const values = assessment?.values || {}
    const rows = allIndicators(framework)
        .filter((ind) => parsed.indicators[ind.code])
        .map((ind) => {
            const incoming = parsed.indicators[ind.code]
            const existing = values[ind.code] || {}
            const fields = ['previous', 'current', 'target'].filter(
                (f) => f in incoming && !sameNumber(existing[f], incoming[f])
            )
            const hadAny = ['previous', 'current'].some(
                (f) => existing[f] !== undefined && existing[f] !== null && existing[f] !== ''
            )
            let change = !fields.length ? CHANGE.SAME : hadAny ? CHANGE.CHANGED : CHANGE.NEW
            if (change !== CHANGE.SAME && !canEdit(ind.code)) {
                change = CHANGE.LOCKED
            }
            return {
                code: ind.code,
                name: ind.name,
                change,
                fields,
                before: existing,
                after: incoming,
                replacesDhis2: existing.source === 'dhis2' && fields.length > 0,
            }
        })

    const milestoneRows = allMilestones(framework)
        .filter((m) => parsed.milestones[m.code])
        .map((m) => {
            const incoming = parsed.milestones[m.code]
            const existing = assessment?.milestones?.[m.code] || {}
            const differs =
                (incoming.status || null) !== (existing.status || null) ||
                ('evidence' in incoming && (incoming.evidence || '') !== (existing.evidence || ''))
            return {
                code: m.code,
                name: m.title || m.name || m.code,
                change: !differs ? CHANGE.SAME : existing.status ? CHANGE.CHANGED : CHANGE.NEW,
                before: existing,
                after: incoming,
            }
        })

    const count = (list, c) => list.filter((r) => r.change === c).length
    return {
        rows,
        milestoneRows,
        summary: {
            new: count(rows, CHANGE.NEW) + count(milestoneRows, CHANGE.NEW),
            changed: count(rows, CHANGE.CHANGED) + count(milestoneRows, CHANGE.CHANGED),
            same: count(rows, CHANGE.SAME) + count(milestoneRows, CHANGE.SAME),
            locked: count(rows, CHANGE.LOCKED),
        },
    }
}

/**
 * The assessment with the comparison's new and changed rows applied. Uploaded
 * figures are marked `source: 'upload'`, and the upload is written into the
 * record's history with the file name and counts.
 */
export const applyUpload = (assessment, comparison, { fileName, user, includeMilestones = true }) => {
    const apply = (r) => r.change === CHANGE.NEW || r.change === CHANGE.CHANGED
    const values = { ...(assessment.values || {}) }
    const uploadedAt = new Date().toISOString()
    comparison.rows.filter(apply).forEach((r) => {
        const next = { ...(values[r.code] || {}) }
        r.fields.forEach((f) => {
            next[f] = r.after[f]
        })
        values[r.code] = { ...next, source: 'upload', uploadedAt }
    })
    const milestones = { ...(assessment.milestones || {}) }
    const msApplied = includeMilestones ? comparison.milestoneRows.filter(apply) : []
    msApplied.forEach((r) => {
        milestones[r.code] = { ...(milestones[r.code] || {}), ...r.after }
    })
    const indicatorCount = comparison.rows.filter(apply).length
    return withHistory(
        { ...assessment, values, milestones },
        {
            by: user?.displayName || user?.username || null,
            action: 'UPLOADED',
            note: i18n.t('{{file}} — {{count}} indicator(s), {{ms}} milestone(s)', {
                file: fileName || i18n.t('Excel file'),
                count: indicatorCount,
                ms: msApplied.length,
            }),
        }
    )
}
