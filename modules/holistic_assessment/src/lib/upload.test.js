/** Reading an uploaded workbook laid out like the form, and applying it. */
import { getFramework } from '../framework/index.js'
import { STATUS } from './constants.js'
import {
    CHANGE,
    applyUpload,
    cellValue,
    compareUpload,
    locateColumns,
    parseUpload,
    readNumber,
} from './upload.js'
import { canEditIndicator } from './workflow.js'

const framework = getFramework('ghs-ha-2025')
const district = getFramework('ghs-ha-2025-district')
const YEAR = 2025
const OU = 'R1aaaaaaaaa'

const header = ['Objective', 'Code', 'Indicator', 'Direction', 'Target', '2024 (previous year)', '2025 (current year)', 'Change']

/** A workbook as the template lays it out: title rows, then the table. */
const workbook = (rows, { about, milestones } = {}) => [
    {
        name: 'Indicators',
        rows: [['GHS Holistic Assessment 2025 — Region One'], [], header, ...rows],
    },
    ...(milestones
        ? [{ name: 'Milestones', rows: [['Objective', 'Code', 'Milestone', 'Status', 'Evidence'], ...milestones] }]
        : []),
    ...(about ? [{ name: 'About', rows: Object.entries(about) }] : []),
]

const row = (code, previous, current, extra = {}) => [
    '1',
    code,
    extra.name ?? 'x',
    'higher is better',
    '',
    previous,
    current,
    '',
]

const parse = (sheets, opts = {}) => parseUpload(sheets, { framework, year: YEAR, orgUnitId: OU, ...opts })

describe('reading cells', () => {
    it('flattens formulas, rich text and errors', () => {
        expect(cellValue({ formula: 'A1*2', result: 4 })).toBe(4)
        expect(cellValue({ richText: [{ text: 'Ach' }, { text: 'ieved' }] })).toBe('Achieved')
        expect(cellValue({ error: '#DIV/0!' })).toBe(null)
    })

    it('reads numbers the way people type them', () => {
        expect(readNumber(12.5)).toEqual({ value: 12.5 })
        expect(readNumber('1,234.5')).toEqual({ value: 1234.5 })
        expect(readNumber('85%')).toEqual({ value: 0.85 })
        expect(readNumber(' ')).toEqual({ blank: true })
        expect(readNumber('N/A')).toEqual({ blank: true })
        expect(readNumber('twelve')).toEqual({ invalid: 'twelve' })
        expect(readNumber({ formula: 'B2/C2', result: 0.5 })).toEqual({ value: 0.5 })
    })
})

describe('finding the columns', () => {
    it('finds the two years by the year itself', () => {
        expect(locateColumns(header, YEAR)).toMatchObject({ code: 1, name: 2, target: 4, previous: 5, current: 6 })
    })

    it('falls back to the words previous and current', () => {
        expect(locateColumns(['Code', 'Previous', 'Current'], YEAR)).toMatchObject({ code: 0, previous: 1, current: 2 })
    })

    it('does not mistake one year for the other', () => {
        const cols = locateColumns(['Code', '2025', '2024'], YEAR)
        expect(cols.current).toBe(1)
        expect(cols.previous).toBe(2)
    })
})

describe('parsing an upload', () => {
    it('reads both years for each indicator', () => {
        const parsed = parse(workbook([row('1.1', 6.72, 10.1), row('1.2', '23.5%', 0.2)]))
        expect(parsed.blocked).toBe(false)
        expect(parsed.indicators['1.1']).toEqual({ previous: 6.72, current: 10.1 })
        expect(parsed.indicators['1.2']).toEqual({ previous: 0.235, current: 0.2 })
    })

    it('keeps a blank cell as a deliberate blank', () => {
        expect(parse(workbook([row('1.1', '', 5)])).indicators['1.1']).toEqual({ previous: null, current: 5 })
    })

    it('skips text that is not a number, and says where', () => {
        const parsed = parse(workbook([row('1.1', 'about six', 5)]))
        expect(parsed.indicators['1.1']).toEqual({ current: 5 })
        expect(parsed.problems[0].message).toMatch(/Row 4/)
    })

    it('reports codes that are not in the tool', () => {
        const parsed = parse(workbook([row('9.99', 1, 2)]))
        expect(parsed.indicators).toEqual({})
        expect(parsed.problems[0].message).toMatch(/9\.99/)
    })

    it('ignores headings and notes between rows', () => {
        const parsed = parse(workbook([['Objective 2'], row('2.1', 1, 2), ['Note — figures from the annual report']]))
        expect(Object.keys(parsed.indicators)).toEqual(['2.1'])
        expect(parsed.problems).toEqual([])
    })

    it('tells 1.1 from 1.10 when Excel has turned the code into a number', () => {
        const ten = framework.objectives[0].indicators.find((i) => i.code === '1.10')
        const parsed = parse(workbook([row(1.1, 1, 2, { name: ten.name })]))
        expect(Object.keys(parsed.indicators)).toEqual(['1.10'])
        const unclear = parse(workbook([row(1.1, 1, 2, { name: 'something else' })]))
        expect(unclear.indicators).toEqual({})
        expect(unclear.problems[0].message).toMatch(/1\.1 or 1\.10/)
    })

    it('uses the first of two rows for the same indicator', () => {
        const parsed = parse(workbook([row('1.1', 1, 2), row('1.1', 3, 4)]))
        expect(parsed.indicators['1.1']).toEqual({ previous: 1, current: 2 })
        expect(parsed.problems).toHaveLength(1)
    })

    it('reads milestone statuses by their label', () => {
        const parsed = parse(
            workbook([row('1.1', 1, 2)], {
                milestones: [
                    ['1', 'MS1', '…', 'Achieved', 'Signed minutes'],
                    ['2', 'MS2', '…', 'in progress', ''],
                    ['3', 'MS3', '…', 'maybe', ''],
                ],
            })
        )
        expect(parsed.milestones).toEqual({
            MS1: { status: 'ACHIEVED', evidence: 'Signed minutes' },
            MS2: { status: 'IN_PROGRESS', evidence: '' },
        })
        expect(parsed.problems[0].message).toMatch(/maybe/)
    })

    it('refuses a file made for another year, tool or org unit', () => {
        const about = (a) => parse(workbook([row('1.1', 1, 2)], { about: a }))
        expect(about({ Framework: 'ghs-ha-2025', Year: '2024', 'Org unit id': OU }).blocked).toBe(true)
        expect(about({ Framework: 'ghs-ha-2025-district', Year: '2025' }).blocked).toBe(true)
        expect(about({ Framework: 'ghs-ha-2025', Year: '2025', 'Org unit id': 'OTHERaaaaaa' }).blocked).toBe(true)
        expect(about({ Framework: 'ghs-ha-2025', Year: '2025', 'Org unit id': OU }).blocked).toBe(false)
    })

    it('refuses a file with no indicator table', () => {
        const parsed = parse([{ name: 'Sheet1', rows: [['hello']] }])
        expect(parsed.blocked).toBe(true)
    })

    it('reads a local target only where the tool lets one be set', () => {
        const varying = district.objectives.flatMap((o) => o.indicators).find((i) => i.targetVaries)
        const sheets = workbook([['1', varying.code, 'x', '', 5000, 10, 20, '']])
        const parsed = parseUpload(sheets, { framework: district, year: YEAR })
        expect(parsed.indicators[varying.code]).toEqual({ previous: 10, current: 20, target: 5000 })
    })
})

describe('comparing and applying', () => {
    const assessment = {
        status: STATUS.DRAFT,
        values: {
            1.1: { previous: 6.72, current: 10.1 },
            1.2: { previous: 0.2, current: 0.1, source: 'dhis2' },
        },
        milestones: {},
        history: [],
    }
    const parsed = parse(
        workbook([row('1.1', 6.72, 10.1), row('1.2', 0.2, 0.3), row('1.3', 5, 6)], {
            milestones: [['1', 'MS1', '…', 'Achieved', 'Minutes']],
        })
    )

    it('sorts every row into new, changed or the same', () => {
        const cmp = compareUpload(assessment, parsed, { framework })
        const byCode = Object.fromEntries(cmp.rows.map((r) => [r.code, r]))
        expect(byCode['1.1'].change).toBe(CHANGE.SAME)
        expect(byCode['1.2'].change).toBe(CHANGE.CHANGED)
        expect(byCode['1.2'].fields).toEqual(['current'])
        expect(byCode['1.2'].replacesDhis2).toBe(true)
        expect(byCode['1.3'].change).toBe(CHANGE.NEW)
        expect(cmp.summary).toEqual({ new: 2, changed: 1, same: 1, locked: 0 })
    })

    it('marks rows the record will not let change as locked', () => {
        const revision = {
            ...assessment,
            status: STATUS.REVISION,
            review: { indicators: { 1.2: { suggestedValue: 0.3 } } },
        }
        const cmp = compareUpload(revision, parsed, {
            framework,
            canEdit: (code) => canEditIndicator(revision, code),
        })
        const byCode = Object.fromEntries(cmp.rows.map((r) => [r.code, r]))
        expect(byCode['1.2'].change).toBe(CHANGE.CHANGED)
        expect(byCode['1.3'].change).toBe(CHANGE.LOCKED)
    })

    it('applies only new and changed rows, marked as uploaded, with a history entry', () => {
        const cmp = compareUpload(assessment, parsed, { framework })
        const next = applyUpload(assessment, cmp, { fileName: 'region-one.xlsx', user: { displayName: 'Owner' } })
        expect(next.values['1.1']).toEqual(assessment.values['1.1'])
        expect(next.values['1.2']).toMatchObject({ previous: 0.2, current: 0.3, source: 'upload' })
        expect(next.values['1.3']).toMatchObject({ previous: 5, current: 6, source: 'upload' })
        expect(next.milestones.MS1).toEqual({ status: 'ACHIEVED', evidence: 'Minutes' })
        expect(next.history.at(-1)).toMatchObject({ action: 'UPLOADED', by: 'Owner' })
        expect(next.history.at(-1).note).toMatch(/region-one\.xlsx/)
        expect(assessment.values['1.2'].current).toBe(0.1) // the original is untouched
    })
})

describe('the downloadable template', () => {
    it('round-trips through a real .xlsx file', async () => {
        const { buildTemplate } = await import('./uploadTemplate.js')
        const ExcelJS = (await import('exceljs')).default
        const assessment = {
            values: { '1.1': { previous: 6.72, current: 10.1 }, '1.10': { previous: 3, current: 4 } },
            milestones: { MS2: { status: 'IN_PROGRESS', evidence: 'Draft plan' } },
        }
        const wb = await buildTemplate({
            framework,
            year: YEAR,
            level: 'REGION',
            orgUnit: { id: OU, displayName: 'Region One' },
            assessment,
        })
        const reloaded = new ExcelJS.Workbook()
        await reloaded.xlsx.load(await wb.xlsx.writeBuffer())

        const sheets = (await import('./upload.js')).readWorkbook(reloaded)
        const parsed = parse(sheets)
        expect(parsed.blocked).toBe(false)
        expect(parsed.problems).toEqual([])
        expect(Object.keys(parsed.indicators)).toHaveLength(94)
        expect(parsed.indicators['1.1']).toEqual({ previous: 6.72, current: 10.1 })
        expect(parsed.indicators['1.10']).toEqual({ previous: 3, current: 4 })
        expect(parsed.indicators['2.1']).toEqual({ previous: null, current: null })
        expect(parsed.milestones.MS2).toEqual({ status: 'IN_PROGRESS', evidence: 'Draft plan' })

        // Unchanged template, so nothing to apply.
        const cmp = compareUpload(assessment, parsed, { framework })
        expect(cmp.summary.new + cmp.summary.changed).toBe(0)

        // The change column is a live formula.
        const changeCell = reloaded.getWorksheet('Indicators').getCell('H5')
        expect(changeCell.value.formula).toMatch(/ISNUMBER\(F5\)/)

        // A template for another org unit is refused.
        expect(parse(sheets, { orgUnitId: 'OTHERaaaaaa' }).blocked).toBe(true)
    }, 30000)
})
