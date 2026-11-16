import i18n from '@dhis2/d2-i18n'
import {
    LEVEL,
    PERFORMANCE_CATEGORIES,
    PERFORMANCE_LABEL,
    STATUS,
    STATUS_LABEL,
} from '../lib/constants.js'
import {
    fmtPercent,
    fmtPerformance,
    fmtScore,
    fmtSignedPercent,
    performanceCategory,
} from '../lib/format.js'
import { reviewCompletion } from '../lib/workflow.js'
import { column, numericColumn, report, section } from './model.js'

/*
 * The seven reports.
 *
 * Every one is built from assessments already in the datastore — the same
 * records the dashboard reads — so none of them makes an analytics call, and
 * two reports of the same year can never disagree about a figure.
 *
 * A builder is given a context and returns a report model. It knows nothing
 * about screens or file formats: the renderer and the exporters take it from
 * there.
 */

const SUBMITTED_ONWARDS = new Set([
    STATUS.SUBMITTED,
    STATUS.UNDER_REVIEW,
    STATUS.APPROVED,
])

const name = (record) => record.orgUnit?.name || '—'
const parentName = (record) => record.orgUnit?.parentName || '—'

const categoryOf = (result) => performanceCategory(result.performance)
const categoryLabel = (result) => PERFORMANCE_LABEL[categoryOf(result)]

const byPerformance = (a, b) => b.result.performance - a.result.performance

const text = (v) =>
    v === null || v === undefined || v === '' ? '—' : String(v)

/** A row that carries both the text to read and the number to sum. */
const row = (values, raw) => ({ ...values, _raw: raw })

const regionsOf = (scored) =>
    scored.filter((s) => s.record.level === LEVEL.REGION)
const districtsOf = (scored) =>
    scored.filter((s) => s.record.level === LEVEL.DISTRICT)

const mean = (rows, pick) =>
    rows.length ? rows.reduce((sum, r) => sum + pick(r), 0) / rows.length : null

/** How many assessments fall in each performance band, worst band last. */
const distribution = (scored) =>
    PERFORMANCE_CATEGORIES.map(({ key }) => ({
        key,
        label: PERFORMANCE_LABEL[key],
        count: scored.filter((s) => categoryOf(s.result) === key).length,
    }))

const RANK = numericColumn('rank', i18n.t('Rank'), { width: 8 })
const UNIT = column('unit', i18n.t('Organisation unit'), { width: 28 })
const STATUS_COL = column('status', i18n.t('Status'))
const SCORE = numericColumn('performance', i18n.t('Score (0-5)'))
const CATEGORY = column('category', i18n.t('Category'), { width: 24 })
const COMPLETION = numericColumn('completion', i18n.t('Complete'))

const leagueColumns = [RANK, UNIT, STATUS_COL, SCORE, CATEGORY, COMPLETION]

const leagueRows = (scored) =>
    [...scored].sort(byPerformance).map((s, i) =>
        row(
            {
                rank: i + 1,
                unit: name(s.record),
                status: STATUS_LABEL[s.record.status] || s.record.status,
                performance: fmtPerformance(s.result.performance),
                category: categoryLabel(s.result),
                completion: fmtPercent(s.result.completion, 0),
            },
            {
                rank: i + 1,
                performance: s.result.performance,
                completion: s.result.completion,
            }
        )
    )

/* ---------------------------------------------------------------- 1 of 7 -- */

const nationalSummary = ({ scored, year }) => {
    const regions = regionsOf(scored)
    const districts = districtsOf(scored)
    const average = mean(regions, (s) => s.result.performance)

    const overview = section(
        i18n.t('Overview'),
        [
            column('measure', i18n.t('Measure'), { width: 34 }),
            column('value', i18n.t('Value')),
        ],
        [
            row(
                {
                    measure: i18n.t('National score (mean of regions)'),
                    value: average === null ? '—' : fmtPerformance(average),
                },
                { value: average }
            ),
            row({
                measure: i18n.t('National category'),
                value:
                    average === null
                        ? '—'
                        : PERFORMANCE_LABEL[performanceCategory(average)],
            }),
            row(
                {
                    measure: i18n.t('Regions assessed'),
                    value: String(regions.length),
                },
                { value: regions.length }
            ),
            row(
                {
                    measure: i18n.t('Regions submitted or beyond'),
                    value: String(
                        regions.filter((s) =>
                            SUBMITTED_ONWARDS.has(s.record.status)
                        ).length
                    ),
                },
                {
                    value: regions.filter((s) =>
                        SUBMITTED_ONWARDS.has(s.record.status)
                    ).length,
                }
            ),
            row(
                {
                    measure: i18n.t('Districts assessed'),
                    value: String(districts.length),
                },
                { value: districts.length }
            ),
            row({
                measure: i18n.t('Mean regional completion'),
                value: fmtPercent(
                    mean(regions, (s) => s.result.completion),
                    0
                ),
            }),
        ],
        {
            note: i18n.t(
                'The national score is the unweighted mean of the regional scores. Districts are assessed on a different instrument against their own targets, so they are counted here but not averaged into it.'
            ),
        }
    )

    const bands = section(
        i18n.t('Performance category distribution'),
        [
            column('category', i18n.t('Category'), { width: 26 }),
            numericColumn('regions', i18n.t('Regions')),
            numericColumn('districts', i18n.t('Districts')),
        ],
        distribution(regions).map((band, i) => {
            const districtCount = distribution(districts)[i].count
            return row(
                {
                    category: band.label,
                    regions: String(band.count),
                    districts: String(districtCount),
                },
                { regions: band.count, districts: districtCount }
            )
        })
    )

    const ranking = section(
        i18n.t('Regions ranked'),
        leagueColumns,
        leagueRows(regions)
    )

    return report({
        id: `national-summary-${year}`,
        title: i18n.t('National Summary'),
        subtitle: i18n.t('{{year}} holistic assessment', { year }),
        meta: [
            i18n.t('{{count}} regions', { count: regions.length }),
            i18n.t('{{count}} districts', { count: districts.length }),
        ],
        sections: [overview, bands, ranking],
    })
}

/* ---------------------------------------------------------------- 2 of 7 -- */

const objectiveColumns = (scored) => {
    const first = scored[0]
    if (!first) {
        return []
    }
    return first.result.objectives.map((o) =>
        numericColumn(`obj${o.index}`, i18n.t('Obj {{n}}', { n: o.index }))
    )
}

const regionalPerformance = ({ scored, year }) => {
    const regions = [...regionsOf(scored)].sort(byPerformance)
    const objCols = objectiveColumns(regions)

    const table = section(
        i18n.t('Regional comparison'),
        [RANK, UNIT, STATUS_COL, ...objCols, SCORE, CATEGORY, COMPLETION],
        regions.map((s, i) =>
            row(
                {
                    rank: i + 1,
                    unit: name(s.record),
                    status: STATUS_LABEL[s.record.status] || s.record.status,
                    ...Object.fromEntries(
                        s.result.objectives.map((o) => [
                            `obj${o.index}`,
                            fmtPerformance(o.performance),
                        ])
                    ),
                    performance: fmtPerformance(s.result.performance),
                    category: categoryLabel(s.result),
                    completion: fmtPercent(s.result.completion, 0),
                },
                {
                    rank: i + 1,
                    ...Object.fromEntries(
                        s.result.objectives.map((o) => [
                            `obj${o.index}`,
                            o.performance,
                        ])
                    ),
                    performance: s.result.performance,
                    completion: s.result.completion,
                }
            )
        ),
        {
            note: i18n.t(
                'Objective figures are on the same 0-5 scale as the overall score, so they can be read against it directly.'
            ),
        }
    )

    const spread = section(
        i18n.t('Objective spread across regions'),
        [
            column('objective', i18n.t('Objective'), { width: 40 }),
            numericColumn('best', i18n.t('Best')),
            numericColumn('mean', i18n.t('Mean')),
            numericColumn('worst', i18n.t('Worst')),
        ],
        (regions[0]?.result.objectives || []).map((o, at) => {
            const values = regions.map(
                (s) => s.result.objectives[at]?.performance ?? 0
            )
            const best = values.length ? Math.max(...values) : null
            const worst = values.length ? Math.min(...values) : null
            const avg = mean(
                regions,
                (s) => s.result.objectives[at]?.performance ?? 0
            )
            return row(
                {
                    objective: `${o.index}. ${o.title}`,
                    best: fmtPerformance(best),
                    mean: fmtPerformance(avg),
                    worst: fmtPerformance(worst),
                },
                { best, mean: avg, worst }
            )
        })
    )

    return report({
        id: `regional-performance-${year}`,
        title: i18n.t('Regional Performance'),
        subtitle: i18n.t('{{year}} holistic assessment', { year }),
        meta: [i18n.t('{{count}} regions', { count: regions.length })],
        sections: [table, spread],
    })
}

/* ---------------------------------------------------------------- 3 of 7 -- */

const objectivePerformance = ({ scored, year, objectiveIndex }) => {
    const units = [...scored].sort(byPerformance)
    const at = Math.max(0, (objectiveIndex || 1) - 1)
    const title = units[0]?.result.objectives[at]?.title || ''

    const scores = section(
        i18n.t('Objective score by organisation unit'),
        [
            UNIT,
            column('level', i18n.t('Level')),
            numericColumn('score', i18n.t('Objective score (0-5)')),
            CATEGORY,
            numericColumn('answered', i18n.t('Rows answered')),
            COMPLETION,
        ],
        units.map((s) => {
            const o = s.result.objectives[at]
            if (!o) {
                return row({ unit: name(s.record) })
            }
            return row(
                {
                    unit: name(s.record),
                    level: s.record.level,
                    score: fmtPerformance(o.performance),
                    category:
                        PERFORMANCE_LABEL[performanceCategory(o.performance)],
                    answered: `${o.answered} / ${o.total}`,
                    completion: fmtPercent(o.completion, 0),
                },
                {
                    score: o.performance,
                    answered: o.answered,
                    completion: o.completion,
                }
            )
        })
    )

    const milestones = section(
        i18n.t('Milestone'),
        [
            UNIT,
            column('milestone', i18n.t('Milestone'), { width: 40 }),
            column('milestoneStatus', i18n.t('Status')),
            numericColumn('outcome', i18n.t('Outcome')),
        ],
        units.map((s) => {
            const ms = s.result.objectives[at]?.milestoneRow
            return row(
                {
                    unit: name(s.record),
                    milestone: ms?.milestone?.name || '—',
                    milestoneStatus: text(ms?.status),
                    outcome: text(ms?.outcome),
                },
                { outcome: ms?.outcome }
            )
        })
    )

    return report({
        id: `objective-${objectiveIndex}-performance-${year}`,
        title: i18n.t('Objective {{n}} Performance', { n: objectiveIndex }),
        subtitle: title
            ? `${title} · ${year}`
            : i18n.t('{{year}} holistic assessment', { year }),
        meta: [i18n.t('{{count}} assessments', { count: units.length })],
        sections: [scores, milestones],
    })
}

/* ---------------------------------------------------------------- 4 of 7 -- */

const indicatorAnalysis = ({ scored, year, indicatorCode }) => {
    const units = [...scored].sort((a, b) =>
        name(a.record).localeCompare(name(b.record))
    )

    const found = units
        .map((s) => {
            for (const objective of s.result.objectives) {
                const hit = objective.indicatorRows.find(
                    (r) => r.indicator.code === indicatorCode
                )
                if (hit) {
                    return { scored: s, row: hit }
                }
            }
            return null
        })
        .filter(Boolean)

    const indicator = found[0]?.row.indicator
    const outcomes = found.map((f) => f.row.outcome)

    const table = section(
        i18n.t('By organisation unit'),
        [
            UNIT,
            column('level', i18n.t('Level')),
            numericColumn('previous', i18n.t('Previous')),
            numericColumn('current', i18n.t('Current')),
            numericColumn('target', i18n.t('Target')),
            column('change', i18n.t('Change')),
            column('gap', i18n.t('Gap')),
            column('achieved', i18n.t('Target met')),
            numericColumn('outcome', i18n.t('Outcome')),
        ],
        found.map(({ scored: s, row: r }) =>
            row(
                {
                    unit: name(s.record),
                    level: s.record.level,
                    previous: text(r.previous),
                    current: text(r.current),
                    target: text(r.indicator.target),
                    change:
                        r.change === null ? '—' : fmtSignedPercent(r.change),
                    gap: r.gap === null ? '—' : fmtSignedPercent(r.gap),
                    achieved: r.targetAchieved ? i18n.t('Yes') : i18n.t('No'),
                    outcome: String(r.outcome),
                },
                {
                    previous: r.previous,
                    current: r.current,
                    target: r.indicator.target,
                    outcome: r.outcome,
                }
            )
        ),
        {
            note: indicator
                ? i18n.t('{{direction}} indicator. {{definition}}', {
                      direction:
                          indicator.direction === 'negative'
                              ? i18n.t('A lower figure is better on this')
                              : i18n.t('A higher figure is better on this'),
                      definition: indicator.definition || '',
                  })
                : null,
        }
    )

    const spread = section(
        i18n.t('Outcome spread'),
        [
            numericColumn('outcome', i18n.t('Outcome')),
            numericColumn('count', i18n.t('Organisation units')),
        ],
        [2, 1, 0, -1, -2].map((value) =>
            row(
                {
                    outcome: String(value),
                    count: String(outcomes.filter((o) => o === value).length),
                },
                {
                    outcome: value,
                    count: outcomes.filter((o) => o === value).length,
                }
            )
        )
    )

    return report({
        id: `indicator-${indicatorCode}-${year}`,
        title: indicator
            ? `${indicator.code} — ${indicator.name}`
            : i18n.t('Indicator Analysis'),
        subtitle: i18n.t('{{year}} holistic assessment', { year }),
        meta: [
            i18n.t('{{count}} organisation units report this row', {
                count: found.length,
            }),
        ],
        sections: [table, spread],
    })
}

/* ------------------------------------------------------------- 5 & 7 of 7 -- */

/**
 * Peer review, at whichever level is asked for. Regional and district peer
 * review are the same report over a different set of assessments, so they are
 * one builder: the reports differ in what they are given, not in what they do.
 */
const peerReview = ({ scored, year, level }) => {
    const units = [...scored]
        .filter((s) => s.record.level === level)
        .sort((a, b) => name(a.record).localeCompare(name(b.record)))

    const reviewed = units.filter((s) => s.record.review)

    const table = section(
        i18n.t('Review status'),
        [
            UNIT,
            column('reviewer', i18n.t('Reviewer')),
            STATUS_COL,
            column('recommendation', i18n.t('Recommendation')),
            numericColumn('verified', i18n.t('Rows verified')),
            numericColumn('adjustments', i18n.t('Adjustments')),
            column('submittedAt', i18n.t('Review submitted')),
        ],
        units.map((s) => {
            const review = s.record.review || {}
            const verified = reviewCompletion(s.record, s.result.totalRows)
            const adjustments = Object.values(review.indicators || {}).filter(
                (r) =>
                    r?.suggestedValue !== undefined &&
                    r?.suggestedValue !== null &&
                    r?.suggestedValue !== ''
            ).length
            return row(
                {
                    unit: name(s.record),
                    reviewer: text(review.reviewerName || review.reviewer),
                    status: STATUS_LABEL[s.record.status] || s.record.status,
                    recommendation: text(review.recommendation),
                    verified: fmtPercent(verified, 0),
                    adjustments: String(adjustments),
                    submittedAt: review.submittedAt
                        ? review.submittedAt.slice(0, 10)
                        : '—',
                },
                { verified, adjustments }
            )
        })
    )

    const completion = section(
        i18n.t('Completion'),
        [
            column('measure', i18n.t('Measure'), { width: 34 }),
            column('value', i18n.t('Value')),
        ],
        [
            row(
                {
                    measure: i18n.t('Assessments at this level'),
                    value: String(units.length),
                },
                { value: units.length }
            ),
            row(
                {
                    measure: i18n.t('With a review started'),
                    value: String(reviewed.length),
                },
                { value: reviewed.length }
            ),
            row(
                {
                    measure: i18n.t('Approved'),
                    value: String(
                        units.filter((s) => s.record.status === STATUS.APPROVED)
                            .length
                    ),
                },
                {
                    value: units.filter(
                        (s) => s.record.status === STATUS.APPROVED
                    ).length,
                }
            ),
            row(
                {
                    measure: i18n.t('Awaiting revision'),
                    value: String(
                        units.filter((s) => s.record.status === STATUS.REVISION)
                            .length
                    ),
                },
                {
                    value: units.filter(
                        (s) => s.record.status === STATUS.REVISION
                    ).length,
                }
            ),
        ]
    )

    const regional = level === LEVEL.REGION
    return report({
        id: `${regional ? 'regional' : 'district'}-peer-review-${year}`,
        title: regional
            ? i18n.t('Peer Review Summary')
            : i18n.t('District Peer Review'),
        subtitle: i18n.t('{{year}} holistic assessment', { year }),
        meta: [
            i18n.t('{{count}} of {{total}} reviewed', {
                count: reviewed.length,
                total: units.length,
            }),
        ],
        sections: [completion, table],
    })
}

/* ---------------------------------------------------------------- 6 of 7 -- */

const districtPerformance = ({ scored, year, regionId }) => {
    const all = districtsOf(scored)
    const districts = regionId
        ? all.filter((s) => s.record.orgUnit?.parentId === regionId)
        : all
    const regionLabel = districts[0] ? parentName(districts[0].record) : null

    const table = section(
        regionId
            ? i18n.t('Districts of {{region}}', { region: regionLabel })
            : i18n.t('All districts'),
        [
            RANK,
            UNIT,
            column('region', i18n.t('Region'), { width: 22 }),
            STATUS_COL,
            SCORE,
            CATEGORY,
            COMPLETION,
        ],
        [...districts].sort(byPerformance).map((s, i) =>
            row(
                {
                    rank: i + 1,
                    unit: name(s.record),
                    region: parentName(s.record),
                    status: STATUS_LABEL[s.record.status] || s.record.status,
                    performance: fmtPerformance(s.result.performance),
                    category: categoryLabel(s.result),
                    completion: fmtPercent(s.result.completion, 0),
                },
                {
                    rank: i + 1,
                    performance: s.result.performance,
                    completion: s.result.completion,
                }
            )
        ),
        {
            note: i18n.t(
                'Districts are ranked within the set shown. A district is scored on the district tool against district targets, so its figure is not comparable with a region’s.'
            ),
        }
    )

    const bands = section(
        i18n.t('Performance category distribution'),
        [
            column('category', i18n.t('Category'), { width: 26 }),
            numericColumn('count', i18n.t('Districts')),
        ],
        distribution(districts).map((band) =>
            row(
                { category: band.label, count: String(band.count) },
                { count: band.count }
            )
        )
    )

    return report({
        id: `district-performance-${year}`,
        title: i18n.t('District Performance'),
        subtitle: regionLabel
            ? `${regionLabel} · ${year}`
            : i18n.t('{{year}} holistic assessment', { year }),
        meta: [i18n.t('{{count}} districts', { count: districts.length })],
        sections: [table, bands],
    })
}

/* --------------------------------------------------------------------------- */

/**
 * The seven reports the administration guide lists, in its order.
 *
 * `needs` names the extra choice a report cannot be built without — which
 * objective, which indicator, which region — so the page can offer exactly that
 * control and nothing else.
 */
export const REPORTS = [
    {
        id: 'national-summary',
        name: () => i18n.t('National Summary'),
        description: () =>
            i18n.t(
                'High-level overview across all regions — overall scores, rankings and the spread of performance categories.'
            ),
        build: nationalSummary,
    },
    {
        id: 'regional-performance',
        name: () => i18n.t('Regional Performance'),
        description: () =>
            i18n.t(
                'Regional comparison with rankings, a breakdown by objective and the spread of each objective across regions.'
            ),
        build: regionalPerformance,
    },
    {
        id: 'objective-performance',
        name: () => i18n.t('Objective Performance'),
        description: () =>
            i18n.t(
                'One objective in depth — its score for every organisation unit, how complete it is, and the milestone attached to it.'
            ),
        needs: 'objective',
        build: objectivePerformance,
    },
    {
        id: 'indicator-analysis',
        name: () => i18n.t('Indicator Analysis'),
        description: () =>
            i18n.t(
                'One indicator across every organisation unit — target, current and previous values, change, gap and outcome.'
            ),
        needs: 'indicator',
        build: indicatorAnalysis,
    },
    {
        id: 'peer-review-summary',
        name: () => i18n.t('Peer Review Summary'),
        description: () =>
            i18n.t(
                'Regional peer review — who reviewed whom, how far each review got, what was adjusted and what was recommended.'
            ),
        build: (ctx) => peerReview({ ...ctx, level: LEVEL.REGION }),
    },
    {
        id: 'district-performance',
        name: () => i18n.t('District Performance'),
        description: () =>
            i18n.t(
                'District scores, rankings and performance categories, for one region or for the whole country.'
            ),
        needs: 'region',
        build: districtPerformance,
    },
    {
        id: 'district-peer-review',
        name: () => i18n.t('District Peer Review'),
        description: () =>
            i18n.t(
                'District peer review — review status, feedback and the score adjustments made at district level.'
            ),
        build: (ctx) => peerReview({ ...ctx, level: LEVEL.DISTRICT }),
    },
]

export const reportById = (id) => REPORTS.find((r) => r.id === id) || REPORTS[0]

export { fmtScore }
