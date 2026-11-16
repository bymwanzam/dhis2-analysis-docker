import i18n from '@dhis2/d2-i18n'
import { downloadText, toCsv } from '../lib/format.js'
import { cellValue, sectionToRows } from './model.js'

/*
 * Getting a report out of the app: as CSV, as a spreadsheet, as a PDF, or onto
 * paper. All four read the report model and nothing else, so a new report gets
 * every one of them without writing a line of export code.
 *
 * jsPDF and ExcelJS are loaded on demand rather than imported at the top. They
 * are large — together a good part of the bundle — and most visits to this page
 * only ever look at a report on screen. Importing them here would put them in
 * the initial download for everyone; behind `import()` they are fetched the
 * first time somebody actually exports.
 */

const stamp = () => new Date().toISOString().slice(0, 10)

const fileName = (report, extension) => `${report.id}-${stamp()}.${extension}`

/** Saves a Blob the browser has just built. */
const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

/**
 * One CSV holding every section, separated by a blank line and its heading.
 * A report with a single section comes out as a plain table, which is what most
 * of them are.
 */
export const exportCsv = (report) => {
    const rows = []
    report.sections.forEach((sec, i) => {
        if (report.sections.length > 1) {
            if (i > 0) {
                rows.push([])
            }
            rows.push([sec.heading])
        }
        rows.push(...sectionToRows(sec))
    })
    downloadText(fileName(report, 'csv'), toCsv(rows))
}

/**
 * One worksheet per section, so a multi-section report opens as a workbook with
 * tabs rather than one sheet with gaps in it. Numeric columns carry real
 * numbers, so a column can be summed without being retyped.
 */
export const exportXlsx = async (report) => {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'GHS Holistic Assessment'
    workbook.created = new Date()

    report.sections.forEach((sec, i) => {
        // Excel sheet names cannot exceed 31 characters or contain : \ / ? * [ ]
        const name =
            (sec.heading || `${i18n.t('Sheet')} ${i + 1}`)
                .replace(/[:\\/?*[\]]/g, ' ')
                .slice(0, 31) || `${i + 1}`
        const sheet = workbook.addWorksheet(name)

        sheet.columns = sec.columns.map((c) => ({
            header: c.label,
            key: c.key,
            width: c.width || Math.max(12, Math.min(48, c.label.length + 6)),
        }))

        sec.rows.forEach((row) => {
            sheet.addRow(
                Object.fromEntries(
                    sec.columns.map((c) => [c.key, cellValue(row, c)])
                )
            )
        })

        sheet.getRow(1).font = { bold: true }
        sheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0B6B35' },
        }
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
        sheet.views = [{ state: 'frozen', ySplit: 1 }]
        sec.columns.forEach((c, at) => {
            if (c.numeric) {
                sheet.getColumn(at + 1).alignment = { horizontal: 'right' }
            }
        })
    })

    const buffer = await workbook.xlsx.writeBuffer()
    saveBlob(
        new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        fileName(report, 'xlsx')
    )
}

/**
 * A banner-style PDF: a green header band carrying the title, then each section
 * as a table. Landscape, because these tables are wider than they are long and
 * a portrait page would either clip a column or shrink it past reading.
 */
export const exportPdf = async (report) => {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default

    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: 'a4',
    })
    const width = doc.internal.pageSize.getWidth()
    const BRAND = [11, 107, 53]

    doc.setFillColor(...BRAND)
    doc.rect(0, 0, width, 64, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(report.title, 40, 30)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    if (report.subtitle) {
        doc.text(report.subtitle, 40, 48)
    }

    let cursor = 88
    doc.setTextColor(60, 60, 60)
    if (report.meta.length) {
        doc.setFontSize(9)
        doc.text(report.meta.join('     '), 40, cursor - 10)
        cursor += 4
    }

    report.sections.forEach((sec, i) => {
        if (i > 0) {
            cursor = doc.lastAutoTable.finalY + 32
        }
        if (sec.heading) {
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(11)
            doc.setTextColor(20, 20, 20)
            doc.text(sec.heading, 40, cursor)
            cursor += 12
        }
        autoTable(doc, {
            startY: cursor,
            head: [sec.columns.map((c) => c.label)],
            body: sec.rows.map((row) =>
                sec.columns.map((c) => String(row[c.key] ?? ''))
            ),
            styles: { fontSize: 8, cellPadding: 4 },
            headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [245, 247, 245] },
            columnStyles: Object.fromEntries(
                sec.columns
                    .map((c, at) => [
                        at,
                        c.numeric ? { halign: 'right' } : null,
                    ])
                    .filter(([, v]) => v)
            ),
            margin: { left: 40, right: 40 },
        })
        if (sec.note) {
            doc.setFont('helvetica', 'italic')
            doc.setFontSize(8)
            doc.setTextColor(90, 90, 90)
            doc.text(sec.note, 40, doc.lastAutoTable.finalY + 14, {
                maxWidth: width - 80,
            })
        }
    })

    /*
     * The footer is written last, once the page count is known — a report that
     * runs to four pages has to say so on page one, and jsPDF only knows how
     * many there are after every table has been laid out.
     */
    const pages = doc.internal.getNumberOfPages()
    for (let page = 1; page <= pages; page += 1) {
        doc.setPage(page)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(120, 120, 120)
        doc.text(
            i18n.t('Generated {{date}}', { date: stamp() }),
            40,
            doc.internal.pageSize.getHeight() - 20
        )
        doc.text(
            i18n.t('Page {{page}} of {{pages}}', { page, pages }),
            width - 40,
            doc.internal.pageSize.getHeight() - 20,
            { align: 'right' }
        )
    }

    doc.save(fileName(report, 'pdf'))
}

/**
 * Print what is on screen. The page carries a print stylesheet that hides the
 * app's chrome and lets the report table break across pages, so this needs no
 * second rendering of the report — the thing being printed is the thing being
 * looked at, which is the only way the two cannot disagree.
 */
export const printReport = () => window.print()
