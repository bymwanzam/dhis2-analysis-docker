/*
 * The shape every report is built into.
 *
 * Seven reports, four ways of getting them out — on screen, as CSV, as XLSX, as
 * PDF — is twenty-eight pieces of work if each report knows how to export
 * itself. So no report does. Each one builds this structure and nothing else,
 * and the renderer and the three exporters are written once against it.
 *
 *   report  = { id, title, subtitle, meta[], sections[] }
 *   section = { heading, note, columns[], rows[] }
 *   column  = { key, label, numeric, width }
 *
 * A row is a plain object keyed by column key. Values are already formatted for
 * reading, because the same string should appear on screen, in the PDF and in
 * the CSV; where a spreadsheet wants the number rather than the text — so it can
 * be summed — the column carries `numeric` and the row may carry a parallel
 * `_raw` object holding the unformatted values.
 */

export const column = (key, label, options = {}) => ({
    key,
    label,
    numeric: false,
    width: null,
    ...options,
})

/** A numeric column: right-aligned on screen, a real number in the spreadsheet. */
export const numericColumn = (key, label, options = {}) =>
    column(key, label, { numeric: true, ...options })

export const section = (heading, columns, rows, options = {}) => ({
    heading,
    note: null,
    columns,
    rows,
    ...options,
})

export const report = ({ id, title, subtitle, meta = [], sections = [] }) => ({
    id,
    title,
    subtitle,
    meta,
    sections,
})

/**
 * The value a spreadsheet cell should carry: the raw number where the report
 * kept one, so the column can be summed and sorted, and otherwise the same text
 * the screen shows.
 */
export const cellValue = (row, col) => {
    const raw = row._raw?.[col.key]
    if (col.numeric && typeof raw === 'number' && Number.isFinite(raw)) {
        return raw
    }
    const value = row[col.key]
    return value === null || value === undefined ? '' : value
}

/** A section flattened to a header row plus body rows, which is what CSV wants. */
export const sectionToRows = (sec) => [
    sec.columns.map((c) => c.label),
    ...sec.rows.map((row) => sec.columns.map((c) => cellValue(row, c))),
]
