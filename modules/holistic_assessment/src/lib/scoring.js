/**
 * Scoring engine for the GHS Holistic Assessment.
 *
 * This is a faithful port of the official Excel tool
 * (`*_HA_Scoring_and_Assessment_Tool.xlsx`, sheets "Trend and Scoring" and
 * "Indicator Assessment"). Every rule below maps to a named formula in that
 * workbook so results can be reconciled cell-for-cell with the spreadsheet.
 */

export const NO_DATA_SCORE = -2

/** Change bands, sheet "Trend and Scoring" column O. */
export const CHANGE_BANDS = {
    BIG_DROP: '<=-10%',
    SMALL_DROP: '-10%<C<=-5%',
    FLAT: '5%<=C>-5%',
    RISE: '>5%',
}

/** Gap-to-target bands, sheet "Trend and Scoring" column P. */
export const GAP_BANDS = {
    NEAR: '<=10%',
    MID: '10%<PT<=40%',
    FAR: '>40%',
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** Coerce form input to a number, treating '' / null / whitespace as absent. */
export const toNumber = (v) => {
    if (v === null || v === undefined) {
        return null
    }
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : null
    }
    const s = String(v).trim()
    if (s === '') {
        return null
    }
    const n = Number(s)
    return Number.isFinite(n) ? n : null
}

const hasRangeTarget = (indicator) =>
    isNum(indicator.targetLower) && isNum(indicator.targetUpper)

/**
 * The target actually in force for one row.
 *
 * Some targets are set locally rather than nationally — a district's Couple
 * Year Protection target scales with its population, for example — so an
 * assessment may carry its own target, which wins over the framework default.
 * Indicators known to work this way are flagged `targetVaries`.
 */
export const effectiveTarget = (indicator, entry = {}) => {
    const override = toNumber(entry.target)
    return override === null ? indicator.target : override
}

/** The indicator as scored, with any local target folded in. */
const withEffectiveTarget = (indicator, entry) => {
    const target = effectiveTarget(indicator, entry)
    return target === indicator.target ? indicator : { ...indicator, target }
}

/**
 * Year-on-year change. Column H.
 *   positive indicators: (current - previous) / previous
 *   negative indicators: (previous - current) / current   (a fall is an improvement)
 *
 * The workbook guards with AND(current<>"", F:G<>0), so a zero on either side
 * yields no change value at all.
 */
export const computeChange = (indicator, current, previous) => {
    if (
        !isNum(current) ||
        !isNum(previous) ||
        current === 0 ||
        previous === 0
    ) {
        return null
    }
    return indicator.direction === 'negative'
        ? (previous - current) / current
        : (current - previous) / previous
}

/**
 * Gap between performance and target. Column I.
 *   range targets:      (upper - current) / current
 *   negative indicator: (target - current) / current
 *   positive indicator: (current - target) / target
 */
export const computeGap = (indicator, current, previous) => {
    if (
        !isNum(current) ||
        !isNum(previous) ||
        current === 0 ||
        previous === 0
    ) {
        return null
    }
    if (hasRangeTarget(indicator)) {
        return (indicator.targetUpper - current) / current
    }
    if (!isNum(indicator.target) || indicator.target === 0) {
        return null
    }
    return indicator.direction === 'negative'
        ? (indicator.target - current) / current
        : (current - indicator.target) / indicator.target
}

/**
 * Was the target achieved? Column N.
 *   range targets:      lower <= current <= upper
 *   negative indicator: current <= target   (lower is better)
 *   positive indicator: current >= target
 */
export const isTargetAchieved = (indicator, current) => {
    if (!isNum(current)) {
        return false
    }
    if (hasRangeTarget(indicator)) {
        return (
            current >= indicator.targetLower && current <= indicator.targetUpper
        )
    }
    if (!isNum(indicator.target)) {
        return false
    }
    return indicator.direction === 'negative'
        ? current <= indicator.target
        : current >= indicator.target
}

/**
 * Column O. A change that could not be computed is left blank in the workbook,
 * where a text cell compares greater than any number and so falls through to
 * the ">5%" branch. We reproduce that explicitly rather than by accident.
 */
export const changeBand = (change) => {
    if (!isNum(change)) {
        return CHANGE_BANDS.RISE
    }
    if (change <= -0.1) {
        return CHANGE_BANDS.BIG_DROP
    }
    if (change <= -0.05) {
        return CHANGE_BANDS.SMALL_DROP
    }
    if (change <= 0.05) {
        return CHANGE_BANDS.FLAT
    }
    return CHANGE_BANDS.RISE
}

/** Column P. A blank gap likewise falls through to the "<=10%" branch. */
export const gapBand = (gap) => {
    if (!isNum(gap)) {
        return GAP_BANDS.NEAR
    }
    if (gap >= -0.1) {
        return GAP_BANDS.NEAR
    }
    if (gap >= -0.4) {
        return GAP_BANDS.MID
    }
    return GAP_BANDS.FAR
}

/**
 * The -2..+2 outcome for one indicator. Column K.
 *
 * `firstYear` means no prior-year value was reported at all, in which case the
 * indicator is judged on the target alone since no trend exists.
 */
export const computeOutcome = ({
    dataProvided,
    firstYear,
    targetAchieved,
    change,
    gap,
}) => {
    if (!dataProvided) {
        return NO_DATA_SCORE
    }
    if (firstYear) {
        return targetAchieved ? 1 : 0
    }

    const c = changeBand(change)
    const p = gapBand(gap)

    if (targetAchieved) {
        if (c === CHANGE_BANDS.RISE || c === CHANGE_BANDS.FLAT) {
            return 2
        }
        if (c === CHANGE_BANDS.SMALL_DROP) {
            return 1
        }
        return 0 // BIG_DROP
    }

    if (c === CHANGE_BANDS.RISE) {
        return 1
    }
    if (c === CHANGE_BANDS.FLAT) {
        if (p === GAP_BANDS.NEAR) {
            return 1
        }
        return p === GAP_BANDS.MID ? 0 : -1
    }
    return -1 // SMALL_DROP or BIG_DROP
}

/**
 * Evaluate one indicator end to end from its raw current/previous values.
 * Returns every intermediate the assessment UI needs to explain the score.
 */
export const evaluateIndicator = (rawIndicator, entry = {}) => {
    const indicator = withEffectiveTarget(rawIndicator, entry)
    const current = toNumber(entry.current)
    const previous = toNumber(entry.previous)

    const dataProvided = isNum(current)
    const firstYear = !isNum(previous)
    const change = computeChange(indicator, current, previous)
    const gap = computeGap(indicator, current, previous)
    const targetAchieved = isTargetAchieved(indicator, current)

    const auto = computeOutcome({
        dataProvided,
        firstYear,
        targetAchieved,
        change,
        gap,
    })

    // A reviewer-accepted adjustment, or a documented manual override, wins.
    const override = toNumber(entry.overrideScore)
    const outcome =
        override !== null && override >= -2 && override <= 2 ? override : auto

    return {
        code: indicator.code,
        target: indicator.target,
        targetOverridden: indicator.target !== rawIndicator.target,
        current,
        previous,
        dataProvided,
        firstYear,
        change,
        gap,
        targetAchieved,
        changeBand: changeBand(change),
        gapBand: gapBand(gap),
        autoOutcome: auto,
        outcome,
        overridden: outcome !== auto,
    }
}

/** Milestones are scored directly by the assessor on the same -2..+2 scale. */
export const MILESTONE_OUTCOMES = {
    ACHIEVED: 2,
    IN_PROGRESS: 0,
    NOT_ACHIEVED: -2,
}

export const milestoneOutcome = (status) =>
    Object.prototype.hasOwnProperty.call(MILESTONE_OUTCOMES, status)
        ? MILESTONE_OUTCOMES[status]
        : NO_DATA_SCORE

/**
 * Score a whole assessment.
 *
 * Per the workbook's "Indicator Assessment" sheet:
 *   score_i         = weight_i / SUM(weights of scored rows) / 2 * objWeight * outcome_i
 *   objectiveScore  = SUM(score_i)          bounded by +/- objWeight
 *   milestoneWeight = objWeight * 0.25
 *
 * `values` is keyed by indicator code: { '1.1': { current, previous }, ... }
 * `milestones` is keyed by milestone code: { MS1: { status, evidence }, ... }
 */
export const scoreAssessment = (framework, values = {}, milestones = {}) => {
    const objectives = framework.objectives.map((objective) => {
        const rows = objective.indicators.map((indicator) => ({
            kind: 'indicator',
            indicator,
            weight: indicator.weight ?? 0,
            ...evaluateIndicator(indicator, values[indicator.code]),
        }))

        const milestoneWeight =
            objective.weight * (framework.milestoneWeightFactor ?? 0.25)
        const milestoneEntry = milestones[objective.milestone.code] || {}
        const milestoneRow = {
            kind: 'milestone',
            milestone: objective.milestone,
            code: objective.milestone.code,
            weight: milestoneWeight,
            status: milestoneEntry.status || null,
            evidence: milestoneEntry.evidence || '',
            outcome: milestoneOutcome(milestoneEntry.status),
            dataProvided: Boolean(milestoneEntry.status),
        }

        const scored = [...rows, milestoneRow]
        const weightSum = scored.reduce((sum, r) => sum + (r.weight || 0), 0)

        const withScores = scored.map((r) => ({
            ...r,
            score:
                weightSum > 0
                    ? ((r.weight || 0) / weightSum / 2) *
                      objective.weight *
                      r.outcome
                    : 0,
        }))

        const score = withScores.reduce((sum, r) => sum + r.score, 0)
        const answered = withScores.filter((r) => r.dataProvided).length

        return {
            index: objective.index,
            title: objective.title,
            weight: objective.weight,
            rows: withScores,
            indicatorRows: withScores.filter((r) => r.kind === 'indicator'),
            milestoneRow: withScores.find((r) => r.kind === 'milestone'),
            score,
            maxScore: objective.weight,
            // The same score on the published 0-5 performance scale.
            performance: performanceScale(score, objective.weight),
            answered,
            total: withScores.length,
            completion: withScores.length ? answered / withScores.length : 0,
        }
    })

    const total = objectives.reduce((sum, o) => sum + o.score, 0)
    const maxTotal = objectives.reduce((sum, o) => sum + o.maxScore, 0)
    const answered = objectives.reduce((sum, o) => sum + o.answered, 0)
    const totalRows = objectives.reduce((sum, o) => sum + o.total, 0)

    return {
        objectives,
        total,
        maxTotal,
        // Raw scores run from -maxTotal to +maxTotal. Two rescalings of the
        // same number: `index` on 0-100, and `performance` on the 0-5 scale the
        // assessment is reported and categorised on.
        index: maxTotal > 0 ? ((total + maxTotal) / (2 * maxTotal)) * 100 : 0,
        performance: performanceScale(total, maxTotal),
        answered,
        totalRows,
        completion: totalRows ? answered / totalRows : 0,
    }
}

/**
 * A score on its own -max..+max range, rescaled onto 0-5.
 *
 * Taking the weighted average of the objectives' scaled scores and scaling the
 * weighted total come to the same number, because each objective's weight is
 * exactly its own maximum - so the headline and the three objective figures
 * cannot disagree.
 */
export const performanceScale = (score, maxScore) =>
    maxScore > 0 ? ((score + maxScore) / (2 * maxScore)) * 5 : 0

/** Completion counted the way the submission gate needs it (indicators + milestones). */
export const completionPercent = (framework, values, milestones) =>
    scoreAssessment(framework, values, milestones).completion * 100
