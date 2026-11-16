import i18n from '@dhis2/d2-i18n'
import { allMilestones, targetLabel } from '../framework/index.js'
import { MILESTONE_STATUS, MILESTONE_STATUS_LABEL } from './constants.js'

/**
 * The Excel template for local upload: the assessment form as a workbook, with
 * the previous and current year side by side and the change between them
 * worked out by formula, so the two years can be compared as they are typed.
 *
 * ExcelJS is loaded on demand, as the report exports do, so it stays out of
 * the initial download.
 */

const BRAND = 'FF0B6B35'
const OBJECTIVE_FILL = { 1: 'FFE8F2EC', 2: 'FFEEF4FD', 3: 'FFFDF1E3' }
const OBJECTIVE_INK = { 1: 'FF103F23', 2: 'FF1D4F8F', 3: 'FF8A4408' }
const INPUT_FILL = 'FFFFF8E1'
const LOCKED_FILL = 'FFF3F5F7'

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const thin = { style: 'thin', color: { argb: 'FFD5DCE3' } }
const box = { top: thin, left: thin, bottom: thin, right: thin }

const slug = (s) =>
    String(s || 'assessment')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

const statusLabels = Object.values(MILESTONE_STATUS).map((s) => MILESTONE_STATUS_LABEL[s])

const numberRule = (year) => ({
    type: 'decimal',
    operator: 'between',
    formulae: [-1e15, 1e15],
    allowBlank: true,
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: i18n.t('Numbers only'),
    error: i18n.t('Enter the {{year}} value as a number, or leave it blank.', { year }),
})

export const templateFileName = ({ year, orgUnit }) =>
    `ghs-ha-${year}-${slug(orgUnit?.displayName || orgUnit?.name)}-upload.xlsx`

/** Build the template as an ExcelJS workbook. */
export const buildTemplate = async ({ framework, year, level, orgUnit, assessment, user }) => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    wb.creator = 'GHS Holistic Assessment'
    wb.created = new Date()

    const values = assessment?.values || {}
    const milestones = assessment?.milestones || {}
    const unitName = orgUnit?.displayName || orgUnit?.name || ''
    const prev = year - 1

    /* --------------------------------------------------------- indicators */
    const ws = wb.addWorksheet(i18n.t('Indicators'), {
        views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }],
        properties: { tabColor: { argb: BRAND } },
    })
    ws.columns = [
        { key: 'objective', width: 10 },
        { key: 'code', width: 9 },
        { key: 'name', width: 58 },
        { key: 'direction', width: 17 },
        { key: 'target', width: 16 },
        { key: 'previous', width: 19 },
        { key: 'current', width: 19 },
        { key: 'change', width: 13 },
    ]

    ws.mergeCells('A1:H1')
    const title = ws.getCell('A1')
    title.value = i18n.t('GHS Holistic Assessment {{year}} — {{name}}', { year, name: unitName })
    title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
    title.fill = fill(BRAND)
    title.alignment = { vertical: 'middle', indent: 1 }
    ws.getRow(1).height = 28

    ws.mergeCells('A2:H2')
    const hint = ws.getCell('A2')
    hint.value = i18n.t(
        'Type figures into the yellow {{prev}} and {{year}} columns, using the same units as the form. Change is worked out for you. Leave the Code column as it is.',
        { prev, year }
    )
    hint.font = { italic: true, size: 10, color: { argb: 'FF4A5768' } }
    hint.alignment = { wrapText: true, vertical: 'middle', indent: 1 }
    ws.getRow(2).height = 30

    const header = ws.getRow(3)
    header.values = [
        i18n.t('Objective'),
        i18n.t('Code'),
        i18n.t('Indicator'),
        i18n.t('Direction'),
        i18n.t('Target'),
        i18n.t('{{year}} (previous year)', { year: prev }),
        i18n.t('{{year}} (current year)', { year }),
        i18n.t('Change'),
    ]
    header.height = 22
    header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = fill('FF08522A')
        cell.alignment = { vertical: 'middle', wrapText: true }
        cell.border = box
    })
    ws.autoFilter = 'A3:H3'

    let r = 4
    framework.objectives.forEach((objective) => {
        // A heading row per objective. It has no code, so an upload skips it.
        ws.mergeCells(`A${r}:H${r}`)
        const heading = ws.getCell(`A${r}`)
        heading.value = i18n.t('Objective {{n}} — {{title}}', { n: objective.index, title: objective.title })
        heading.font = { bold: true, color: { argb: OBJECTIVE_INK[objective.index] || 'FF212934' } }
        heading.fill = fill(OBJECTIVE_FILL[objective.index] || LOCKED_FILL)
        heading.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
        ws.getRow(r).height = 20
        r += 1

        objective.indicators.forEach((ind) => {
            const v = values[ind.code] || {}
            const row = ws.getRow(r)
            const negative = ind.direction === 'negative'
            row.getCell('objective').value = objective.index
            row.getCell('code').value = ind.code // a string, so 1.10 stays 1.10
            row.getCell('code').numFmt = '@'
            row.getCell('name').value = ind.name
            row.getCell('direction').value = negative ? i18n.t('lower is better') : i18n.t('higher is better')
            if (ind.targetVaries) {
                row.getCell('target').value = v.target ?? ind.target ?? null
                row.getCell('target').fill = fill(INPUT_FILL)
                row.getCell('target').dataValidation = numberRule(i18n.t('target'))
                row.getCell('target').note = i18n.t('This target is set locally. Enter your own figure.')
            } else {
                row.getCell('target').value = targetLabel(ind)
                row.getCell('target').fill = fill(LOCKED_FILL)
            }
            row.getCell('previous').value = v.previous ?? null
            row.getCell('current').value = v.current ?? null
            ;['previous', 'current'].forEach((k) => {
                const cell = row.getCell(k)
                cell.fill = fill(INPUT_FILL)
                cell.dataValidation = numberRule(k === 'current' ? year : prev)
            })
            // The same change rule the scoring engine uses: a fall is an
            // improvement for an indicator where lower is better.
            const F = `F${r}`
            const G = `G${r}`
            row.getCell('change').value = {
                formula: `IF(AND(ISNUMBER(${F}),ISNUMBER(${G}),${F}<>0,${G}<>0),${negative ? `(${F}-${G})/${G}` : `(${G}-${F})/${F}`},"")`,
            }
            row.getCell('change').numFmt = '+0.0%;-0.0%;0.0%'
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = box
                cell.alignment = { vertical: 'top', wrapText: true, ...(cell.alignment || {}) }
            })
            ;['previous', 'current', 'change', 'target'].forEach((k) => {
                row.getCell(k).alignment = { vertical: 'top', horizontal: 'right' }
            })
            r += 1
        })
    })

    // Change goes green or red as figures are typed. The words beside it say
    // the same thing, so colour is never the only signal.
    ws.addConditionalFormatting({
        ref: `H4:H${r - 1}`,
        rules: [
            { type: 'cellIs', operator: 'greaterThan', formulae: [0.05], style: { font: { color: { argb: 'FF14471A' } }, fill: fill('FFE4F4E5') } },
            { type: 'cellIs', operator: 'lessThan', formulae: [-0.05], style: { font: { color: { argb: 'FF7A1212' } }, fill: fill('FFF7D9D9') } },
        ],
    })

    /* --------------------------------------------------------- milestones */
    const ms = wb.addWorksheet(i18n.t('Milestones'), { views: [{ state: 'frozen', ySplit: 1 }] })
    ms.columns = [
        { header: i18n.t('Objective'), key: 'objective', width: 10 },
        { header: i18n.t('Code'), key: 'code', width: 9 },
        { header: i18n.t('Milestone'), key: 'name', width: 70 },
        { header: i18n.t('Status'), key: 'status', width: 16 },
        { header: i18n.t('Evidence'), key: 'evidence', width: 50 },
    ]
    ms.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = fill('FF08522A')
        cell.border = box
    })
    allMilestones(framework).forEach((m, i) => {
        const entry = milestones[m.code] || {}
        const row = ms.addRow({
            objective: framework.objectives[i]?.index ?? i + 1,
            code: m.code,
            name: m.name,
            status: entry.status ? MILESTONE_STATUS_LABEL[entry.status] : null,
            evidence: entry.evidence || null,
        })
        row.getCell('status').dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`"${statusLabels.join(',')}"`],
            showErrorMessage: true,
            errorTitle: i18n.t('Choose from the list'),
            error: statusLabels.join(', '),
        }
        ;['status', 'evidence'].forEach((k) => {
            row.getCell(k).fill = fill(INPUT_FILL)
        })
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = box
            cell.alignment = { vertical: 'top', wrapText: true }
        })
    })

    /* -------------------------------------------------------------- about */
    // What the file is for. An upload is refused if these do not match the
    // year and organisation unit selected, so figures cannot land on the
    // wrong record.
    const about = wb.addWorksheet(i18n.t('About'))
    about.columns = [{ width: 18 }, { width: 70 }]
    ;[
        ['Framework', framework.id],
        ['Year', String(year)],
        ['Level', level],
        ['Org unit', unitName],
        ['Org unit id', orgUnit?.id || ''],
        ['Generated', new Date().toISOString()],
        ['Generated by', user?.displayName || user?.username || ''],
        [],
        [i18n.t('How to use'), i18n.t('Fill in the Indicators and Milestones sheets, save, and upload the file on the Local Upload page.')],
        ['', i18n.t('The app shows every change before anything is saved.')],
        ['', i18n.t('Do not edit this sheet; it ties the file to its year and organisation unit.')],
    ].forEach((cells) => about.addRow(cells))
    about.getColumn(1).font = { bold: true }

    return wb
}

/** Build the template and hand it to the browser as a download. */
export const downloadTemplate = async (options) => {
    const wb = await buildTemplate(options)
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = templateFileName(options)
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

/** Read an uploaded .xlsx file into an ExcelJS workbook. */
export const loadWorkbookFile = async (file) => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    return wb
}
