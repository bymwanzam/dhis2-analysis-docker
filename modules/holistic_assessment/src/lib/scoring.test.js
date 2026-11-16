/**
 * Reconciles the scoring engine against the official Excel tool.
 *
 * The fixture holds every input and every computed result from the published
 * 2025 Upper East regional workbook, so any drift in the engine shows up as a
 * failing indicator rather than a silently different national score.
 */
import district from '../framework/framework-2025-district.json'
import framework from '../framework/framework-2025.json'
import workbook from './__fixtures__/uer-2025-workbook.json'
import { PERFORMANCE_CATEGORY, PERFORMANCE_LABEL } from './constants.js'
import { performanceCategory } from './format.js'
import {
    changeBand,
    computeChange,
    computeGap,
    computeOutcome,
    effectiveTarget,
    evaluateIndicator,
    gapBand,
    isTargetAchieved,
    milestoneOutcome,
    performanceScale,
    scoreAssessment,
    toNumber,
    CHANGE_BANDS,
    GAP_BANDS,
    NO_DATA_SCORE,
} from './scoring.js'

const byCode = new Map()
framework.objectives.forEach((o) =>
    o.indicators.forEach((i) => byCode.set(i.code, i))
)

const OUTCOME_TO_STATUS = {
    2: 'ACHIEVED',
    0: 'IN_PROGRESS',
    '-2': 'NOT_ACHIEVED',
}

const entryFor = (code) => {
    const exp = workbook.indicators[code]
    return {
        current: exp.current,
        previous: exp.previous,
        // A hard-coded outcome in the workbook is an assessor override, which
        // the app models the same way.
        overrideScore: exp.manualOverride ? exp.outcome : undefined,
    }
}

describe('framework data', () => {
    it('has 94 indicators across three objectives', () => {
        expect(framework.objectives).toHaveLength(3)
        expect(framework.objectives.map((o) => o.indicators.length)).toEqual([
            41, 19, 34,
        ])
        expect(byCode.size).toBe(94)
    })

    it('gives every objective a milestone and a weight', () => {
        framework.objectives.forEach((o) => {
            expect(o.milestone.code).toBe(`MS${o.index}`)
            expect(o.milestone.name.length).toBeGreaterThan(0)
            expect(o.weight).toBeGreaterThan(0)
        })
    })

    it('gives every indicator a weight and a direction', () => {
        byCode.forEach((ind) => {
            expect(typeof ind.weight).toBe('number')
            expect(['positive', 'negative']).toContain(ind.direction)
        })
    })
})

describe('toNumber', () => {
    it.each([
        ['', null],
        ['   ', null],
        [null, null],
        [undefined, null],
        ['abc', null],
        [NaN, null],
        ['0', 0],
        ['12.5', 12.5],
        [7, 7],
    ])('converts %p to %p', (input, expected) => {
        expect(toNumber(input)).toBe(expected)
    })
})

describe('bands', () => {
    it('classifies change', () => {
        expect(changeBand(-0.2)).toBe(CHANGE_BANDS.BIG_DROP)
        expect(changeBand(-0.1)).toBe(CHANGE_BANDS.BIG_DROP)
        expect(changeBand(-0.07)).toBe(CHANGE_BANDS.SMALL_DROP)
        expect(changeBand(0)).toBe(CHANGE_BANDS.FLAT)
        expect(changeBand(0.05)).toBe(CHANGE_BANDS.FLAT)
        expect(changeBand(0.2)).toBe(CHANGE_BANDS.RISE)
    })

    it('treats an uncomputable change the way the workbook does', () => {
        // A blank cell compares greater than any number in Excel, so it lands
        // in the ">5%" branch.
        expect(changeBand(null)).toBe(CHANGE_BANDS.RISE)
    })

    it('classifies gap to target', () => {
        expect(gapBand(0.5)).toBe(GAP_BANDS.NEAR)
        expect(gapBand(-0.1)).toBe(GAP_BANDS.NEAR)
        expect(gapBand(-0.25)).toBe(GAP_BANDS.MID)
        expect(gapBand(-0.9)).toBe(GAP_BANDS.FAR)
        expect(gapBand(null)).toBe(GAP_BANDS.NEAR)
    })
})

describe('direction handling', () => {
    const positive = { direction: 'positive', target: 100 }
    const negative = { direction: 'negative', target: 10 }

    it('computes change in the direction that counts as improvement', () => {
        expect(computeChange(positive, 110, 100)).toBeCloseTo(0.1, 10)
        // For a negative indicator a fall is an improvement.
        expect(computeChange(negative, 8, 10)).toBeCloseTo(0.25, 10)
    })

    it('guards against division by zero', () => {
        expect(computeChange(positive, 10, 0)).toBeNull()
        expect(computeChange(positive, 0, 10)).toBeNull()
        expect(computeGap(positive, 0, 10)).toBeNull()
    })

    it('judges target achievement by direction', () => {
        expect(isTargetAchieved(positive, 100)).toBe(true)
        expect(isTargetAchieved(positive, 99)).toBe(false)
        expect(isTargetAchieved(negative, 10)).toBe(true)
        expect(isTargetAchieved(negative, 11)).toBe(false)
    })

    it('judges range targets as an inclusive band', () => {
        const range = { direction: 'positive', targetLower: 1, targetUpper: 5 }
        expect(isTargetAchieved(range, 1)).toBe(true)
        expect(isTargetAchieved(range, 5)).toBe(true)
        expect(isTargetAchieved(range, 0.9)).toBe(false)
        expect(isTargetAchieved(range, 5.1)).toBe(false)
    })
})

describe('computeOutcome', () => {
    it('scores -2 when no data was supplied', () => {
        expect(computeOutcome({ dataProvided: false, firstYear: false })).toBe(
            NO_DATA_SCORE
        )
    })

    it('judges a first reporting year on the target alone', () => {
        expect(
            computeOutcome({
                dataProvided: true,
                firstYear: true,
                targetAchieved: true,
            })
        ).toBe(1)
        expect(
            computeOutcome({
                dataProvided: true,
                firstYear: true,
                targetAchieved: false,
            })
        ).toBe(0)
    })

    it('rewards a met target that held or improved', () => {
        expect(
            computeOutcome({
                dataProvided: true,
                firstYear: false,
                targetAchieved: true,
                change: 0.2,
            })
        ).toBe(2)
    })

    it('penalises a missed target that declined', () => {
        expect(
            computeOutcome({
                dataProvided: true,
                firstYear: false,
                targetAchieved: false,
                change: -0.3,
            })
        ).toBe(-1)
    })
})

describe('milestones', () => {
    it('maps status to the -2..+2 scale', () => {
        expect(milestoneOutcome('ACHIEVED')).toBe(2)
        expect(milestoneOutcome('IN_PROGRESS')).toBe(0)
        expect(milestoneOutcome('NOT_ACHIEVED')).toBe(-2)
    })

    it('treats an unanswered milestone as no data', () => {
        expect(milestoneOutcome(undefined)).toBe(NO_DATA_SCORE)
        expect(milestoneOutcome('SOMETHING_ELSE')).toBe(NO_DATA_SCORE)
    })
})

describe('reconciliation with the published 2025 workbook', () => {
    const codes = Object.keys(workbook.indicators)

    it.each(codes)('reproduces every intermediate for %s', (code) => {
        const exp = workbook.indicators[code]
        const got = evaluateIndicator(byCode.get(code), entryFor(code))

        if (exp.change !== null) {
            expect(got.change).toBeCloseTo(exp.change, 9)
        }
        if (exp.gap !== null) {
            expect(got.gap).toBeCloseTo(exp.gap, 9)
        }
        if (exp.targetAchieved !== null) {
            expect(got.targetAchieved).toBe(exp.targetAchieved === 'Yes')
        }
        if (exp.changeBand !== null) {
            expect(got.changeBand).toBe(exp.changeBand)
        }
        if (exp.gapBand !== null) {
            expect(got.gapBand).toBe(exp.gapBand)
        }
        expect(got.outcome).toBe(exp.outcome)
    })

    const values = {}
    codes.forEach((code) => {
        values[code] = entryFor(code)
    })
    const milestones = {}
    Object.entries(workbook.milestones).forEach(([code, ms]) => {
        milestones[code] = { status: OUTCOME_TO_STATUS[String(ms.outcome)] }
    })

    const result = scoreAssessment(framework, values, milestones)

    it.each(codes)('reproduces the weighted score for %s', (code) => {
        const want = workbook.indicators[code].score
        const row = result.objectives
            .flatMap((o) => o.indicatorRows)
            .find((r) => r.code === code)
        expect(row.score).toBeCloseTo(want, 9)
    })

    it.each(Object.keys(workbook.milestones))(
        'reproduces the weighted score for %s',
        (code) => {
            const row = result.objectives
                .map((o) => o.milestoneRow)
                .find((r) => r.code === code)
            expect(row.score).toBeCloseTo(workbook.milestones[code].score, 9)
        }
    )

    it('reproduces each objective score', () => {
        result.objectives.forEach((o) => {
            expect(o.score).toBeCloseTo(workbook.objectives[String(o.index)], 9)
        })
    })

    it('reproduces the published total', () => {
        const want = Object.values(workbook.objectives).reduce(
            (a, b) => a + b,
            0
        )
        expect(result.total).toBeCloseTo(want, 9)
        expect(result.maxTotal).toBeCloseTo(3.7333333333333334, 9)
    })
})

describe('the 0-5 performance scale', () => {
    it('puts the floor at 0, a zero raw score at the midpoint and the ceiling at 5', () => {
        expect(performanceScale(-3.7333, 3.7333)).toBeCloseTo(0, 9)
        expect(performanceScale(0, 3.7333)).toBeCloseTo(2.5, 9)
        expect(performanceScale(3.7333, 3.7333)).toBeCloseTo(5, 9)
    })

    it('is 0 rather than NaN when there is nothing to score', () => {
        expect(performanceScale(0, 0)).toBe(0)
    })

    it('agrees with the weighted average of the objectives', () => {
        // Each objective's weight is exactly its own maximum, so scaling the
        // weighted total and averaging the scaled objectives are the same
        // number. The headline can never contradict the three cards under it.
        const values = { 1.1: { current: 5, previous: 4 } }
        const result = scoreAssessment(framework, values, {
            MS1: { status: 'ACHIEVED' },
        })
        const weighted =
            result.objectives.reduce(
                (sum, o) => sum + o.performance * o.maxScore,
                0
            ) / result.objectives.reduce((sum, o) => sum + o.maxScore, 0)
        expect(weighted).toBeCloseTo(result.performance, 9)
    })

    it('tracks the 0-100 index, being the same number differently scaled', () => {
        const result = scoreAssessment(framework, {}, {})
        expect(result.performance).toBeCloseTo((result.index / 100) * 5, 9)
    })
})

describe('performanceCategory', () => {
    it('places each score in its published category', () => {
        expect(performanceCategory(5)).toBe('HIGH')
        expect(performanceCategory(4)).toBe('HIGH')
        expect(performanceCategory(3.99)).toBe('MODERATE')
        expect(performanceCategory(3)).toBe('MODERATE')
        expect(performanceCategory(2.99)).toBe('SUSTAINED')
        expect(performanceCategory(2)).toBe('SUSTAINED')
        expect(performanceCategory(1.99)).toBe('UNDER')
        expect(performanceCategory(1)).toBe('UNDER')
        expect(performanceCategory(0.99)).toBe('SEVERE')
        expect(performanceCategory(0)).toBe('SEVERE')
    })

    it('treats a missing score as the bottom category rather than throwing', () => {
        expect(performanceCategory(null)).toBe('SEVERE')
        expect(performanceCategory(undefined)).toBe('SEVERE')
    })

    it('names every category it can return', () => {
        Object.values(PERFORMANCE_CATEGORY).forEach((key) => {
            expect(PERFORMANCE_LABEL[key]).toEqual(expect.any(String))
            expect(PERFORMANCE_LABEL[key].length).toBeGreaterThan(0)
        })
    })
})

describe('scoreAssessment edge cases', () => {
    it('scores an entirely empty assessment at the floor', () => {
        const result = scoreAssessment(framework, {}, {})
        expect(result.completion).toBe(0)
        // Every row scores -2, so each objective sits at exactly -objWeight.
        result.objectives.forEach((o) => {
            expect(o.score).toBeCloseTo(-o.maxScore, 9)
        })
        expect(result.total).toBeCloseTo(-result.maxTotal, 9)
        expect(result.index).toBeCloseTo(0, 9)
    })

    it('scores a perfect assessment at the ceiling', () => {
        const values = {}
        byCode.forEach((ind, code) => {
            values[code] = { current: 1, previous: 1, overrideScore: 2 }
        })
        const milestones = {
            MS1: { status: 'ACHIEVED' },
            MS2: { status: 'ACHIEVED' },
            MS3: { status: 'ACHIEVED' },
        }
        const result = scoreAssessment(framework, values, milestones)
        expect(result.total).toBeCloseTo(result.maxTotal, 9)
        expect(result.index).toBeCloseTo(100, 9)
        expect(result.completion).toBe(1)
    })

    it('counts completion over indicators and milestones together', () => {
        const result = scoreAssessment(
            framework,
            { 1.1: { current: 5 } },
            { MS1: { status: 'ACHIEVED' } }
        )
        expect(result.totalRows).toBe(97)
        expect(result.answered).toBe(2)
    })
})

describe('district framework', () => {
    it('is a different instrument from the regional one', () => {
        expect(district.id).not.toBe(framework.id)
        expect(district.objectives.map((o) => o.indicators.length)).toEqual([
            40, 19, 34,
        ])
        // The district tool drops one Objective 1 indicator.
        expect(
            district.objectives.reduce((n, o) => n + o.indicators.length, 0)
        ).toBe(93)
    })

    it('shares the objective weights with the regional tool', () => {
        district.objectives.forEach((o, i) => {
            expect(o.weight).toBeCloseTo(framework.objectives[i].weight, 9)
        })
    })

    it('carries its own milestones', () => {
        const regionalNames = framework.objectives.map((o) => o.milestone.name)
        district.objectives.forEach((o) => {
            expect(o.milestone.name.length).toBeGreaterThan(0)
            expect(regionalNames).not.toContain(o.milestone.name)
        })
    })

    it('flags only the targets that districts set locally', () => {
        const varying = district.objectives
            .flatMap((o) => o.indicators)
            .filter((i) => i.targetVaries)
            .map((i) => i.code)
        expect(varying).toEqual(['1.11', '1.37', '1.38'])
    })

    it('scores an empty district assessment at the floor', () => {
        const result = scoreAssessment(district, {}, {})
        expect(result.totalRows).toBe(96)
        expect(result.total).toBeCloseTo(-result.maxTotal, 9)
    })
})

describe('local target overrides', () => {
    const indicator = {
        code: '1.11',
        direction: 'positive',
        target: 350000,
        targetVaries: true,
    }

    it('uses the framework target when none is set locally', () => {
        expect(effectiveTarget(indicator, {})).toBe(350000)
        expect(
            evaluateIndicator(indicator, { current: 2000, previous: 1000 })
                .targetAchieved
        ).toBe(false)
    })

    it('lets a local target decide whether the target was met', () => {
        const entry = { current: 2000, previous: 1000, target: 1319 }
        const got = evaluateIndicator(indicator, entry)
        expect(effectiveTarget(indicator, entry)).toBe(1319)
        expect(got.target).toBe(1319)
        expect(got.targetOverridden).toBe(true)
        expect(got.targetAchieved).toBe(true)
        expect(got.outcome).toBe(2)
    })

    it('ignores a blank or unparseable local target', () => {
        expect(effectiveTarget(indicator, { target: '' })).toBe(350000)
        expect(effectiveTarget(indicator, { target: 'n/a' })).toBe(350000)
    })

    it('does not report an override when the value matches the default', () => {
        const got = evaluateIndicator(indicator, {
            current: 1,
            previous: 1,
            target: 350000,
        })
        expect(got.targetOverridden).toBe(false)
    })
})
