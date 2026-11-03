/** The seven reports, and the model every one of them has to produce. */
import {
    DISTRICT_FRAMEWORK_ID,
    allIndicators,
    getFramework,
} from '../framework/index.js'
import { LEVEL, STATUS } from '../lib/constants.js'
import { scoreAssessment } from '../lib/scoring.js'
import { REPORTS, reportById } from './builders.js'
import { cellValue, sectionToRows } from './model.js'

const regional = getFramework()
const district = getFramework(DISTRICT_FRAMEWORK_ID)

/**
 * An assessment whose every indicator carries the same pair of values, which
 * makes a whole record one line to write and its score predictable enough to
 * reason about without reproducing the scoring engine here.
 */
const valuesFor = (framework, current, previous) =>
    Object.fromEntries(
        allIndicators(framework).map((i) => [i.code, { current, previous }])
    )

const assessment = ({
    name,
    level = LEVEL.REGION,
    parentId = null,
    parentName = null,
    status = STATUS.SUBMITTED,
    current = 10,
    previous = 10,
    review = null,
}) => {
    const framework = level === LEVEL.REGION ? regional : district
    const record = {
        frameworkId: framework.id,
        year: 2025,
        level,
        status,
        orgUnit: { id: name, name, parentId, parentName },
        values: valuesFor(framework, current, previous),
        milestones: {},
        review,
        history: [],
    }
    return {
        record,
        result: scoreAssessment(framework, record.values, record.milestones),
    }
}

const scored = [
    assessment({ name: 'Upper East', current: 12, previous: 10 }),
    assessment({ name: 'Ashanti', current: 8, previous: 10 }),
    assessment({
        name: 'Bongo',
        level: LEVEL.DISTRICT,
        parentId: 'Upper East',
        parentName: 'Upper East',
        current: 11,
        previous: 10,
    }),
    assessment({
        name: 'Talensi',
        level: LEVEL.DISTRICT,
        parentId: 'Upper East',
        parentName: 'Upper East',
        current: 9,
        previous: 10,
    }),
    assessment({
        name: 'Obuasi',
        level: LEVEL.DISTRICT,
        parentId: 'Ashanti',
        parentName: 'Ashanti',
        status: STATUS.APPROVED,
        review: {
            reviewerName: 'Ama Mensah',
            recommendation: 'APPROVE',
            submittedAt: '2026-02-03T10:00:00.000Z',
            indicators: { 1.1: { verified: true, suggestedValue: 7 } },
        },
    }),
]

const ctx = {
    scored,
    year: 2025,
    objectiveIndex: 1,
    indicatorCode: '1.1',
    regionId: null,
}

describe('every report', () => {
    it.each(REPORTS.map((r) => [r.id, r]))(
        '%s builds a well-formed model',
        (id, definition) => {
            const built = definition.build(ctx)

            expect(built.id).toContain('2025')
            expect(typeof built.title).toBe('string')
            expect(built.title.length).toBeGreaterThan(0)
            expect(built.sections.length).toBeGreaterThan(0)

            built.sections.forEach((sec) => {
                expect(sec.columns.length).toBeGreaterThan(0)
                // Every column is addressable and labelled — a missing label
                // would print as an empty heading in all four outputs at once.
                sec.columns.forEach((c) => {
                    expect(typeof c.key).toBe('string')
                    expect(typeof c.label).toBe('string')
                    expect(c.label.length).toBeGreaterThan(0)
                })
                // No row may leave a declared column undefined.
                sec.rows.forEach((row) => {
                    sec.columns.forEach((c) => {
                        expect(cellValue(row, c)).toBeDefined()
                    })
                })
            })
        }
    )

    it.each(REPORTS.map((r) => [r.id, r]))(
        '%s flattens to a rectangle for export',
        (id, definition) => {
            definition.build(ctx).sections.forEach((sec) => {
                const rows = sectionToRows(sec)
                const width = rows[0].length
                rows.forEach((r) => expect(r).toHaveLength(width))
            })
        }
    )

    it('survives a year with no assessments at all', () => {
        REPORTS.forEach((definition) => {
            const built = definition.build({ ...ctx, scored: [] })
            expect(built.sections.length).toBeGreaterThan(0)
        })
    })
})

describe('national summary', () => {
    const built = reportById('national-summary').build(ctx)
    const overview = built.sections[0]

    it('averages the regions and leaves the districts out of it', () => {
        const regions = scored.filter((s) => s.record.level === LEVEL.REGION)
        const expected =
            regions.reduce((sum, s) => sum + s.result.performance, 0) /
            regions.length

        const row = overview.rows.find((r) =>
            r.measure.includes('National score')
        )
        expect(row._raw.value).toBeCloseTo(expected, 10)
    })

    it('counts districts without folding them into the score', () => {
        const row = overview.rows.find((r) =>
            r.measure.includes('Districts assessed')
        )
        expect(row._raw.value).toBe(3)
    })

    it('ranks the better region first', () => {
        const ranking = built.sections[2]
        expect(ranking.rows[0].unit).toBe('Upper East')
        expect(ranking.rows[0].rank).toBe(1)
    })
})

describe('district performance', () => {
    it('shows every district when no region is chosen', () => {
        const built = reportById('district-performance').build(ctx)
        expect(built.sections[0].rows).toHaveLength(3)
    })

    it('narrows to one region when one is chosen', () => {
        const built = reportById('district-performance').build({
            ...ctx,
            regionId: 'Upper East',
        })
        const names = built.sections[0].rows.map((r) => r.unit)
        expect(names).toHaveLength(2)
        expect(names).toContain('Bongo')
        expect(names).toContain('Talensi')
        expect(names).not.toContain('Obuasi')
    })
})

describe('indicator analysis', () => {
    it('reports the chosen row for every unit that carries it', () => {
        const built = reportById('indicator-analysis').build(ctx)
        // All five assessments carry 1.1; both tools have that code.
        expect(built.sections[0].rows).toHaveLength(5)
        expect(built.title).toContain('1.1')
    })

    it('counts each outcome once in the spread', () => {
        const built = reportById('indicator-analysis').build(ctx)
        const spread = built.sections[1]
        const total = spread.rows.reduce((sum, r) => sum + r._raw.count, 0)
        expect(total).toBe(built.sections[0].rows.length)
    })
})

describe('peer review', () => {
    it('keeps the regional and district reports to their own level', () => {
        const regionalReport = reportById('peer-review-summary').build(ctx)
        const districtReport = reportById('district-peer-review').build(ctx)

        expect(regionalReport.sections[1].rows).toHaveLength(2)
        expect(districtReport.sections[1].rows).toHaveLength(3)
    })

    it('counts the adjustments a reviewer suggested', () => {
        const built = reportById('district-peer-review').build(ctx)
        const row = built.sections[1].rows.find((r) => r.unit === 'Obuasi')
        expect(row.reviewer).toBe('Ama Mensah')
        expect(row._raw.adjustments).toBe(1)
    })

    it('counts an approved assessment as approved', () => {
        const built = reportById('district-peer-review').build(ctx)
        const row = built.sections[0].rows.find((r) =>
            r.measure.includes('Approved')
        )
        expect(row._raw.value).toBe(1)
    })
})

describe('objective performance', () => {
    it('reports the objective it was asked for', () => {
        const built = reportById('objective-performance').build({
            ...ctx,
            objectiveIndex: 2,
        })
        expect(built.title).toContain('2')
        expect(built.sections[0].rows).toHaveLength(scored.length)
    })
})
