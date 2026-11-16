/*
 * Year-level target overrides.
 *
 * A framework ships the targets the published workbook scored against, and
 * those are right for the year it was transcribed from. A later year moves the
 * bar, so the Targets tab records what each indicator's target is for a given
 * year, and this module folds those figures into the framework before anything
 * is scored against it.
 *
 * Three layers end up deciding an indicator's target, narrowest last:
 *
 *   1. the framework's own value, from the workbook;
 *   2. the year's override, recorded here;
 *   3. the assessment's own value, for the handful of rows flagged
 *      `targetVaries` where the target is set locally — applied in
 *      `effectiveTarget` when the row is scored, not here.
 *
 * Nothing is stored for a year until somebody edits it, and a framework with no
 * overrides is returned unchanged — the same object, not a copy — so an
 * instance that never opens the Targets tab scores exactly as it did before the
 * tab existed.
 */

/** One indicator's stored override. Absent fields fall through to the framework. */
const applyToIndicator = (indicator, override) => {
    if (!override) {
        return indicator
    }
    const next = { ...indicator }
    let changed = false
    for (const field of ['target', 'targetLower', 'targetUpper']) {
        const value = override[field]
        if (value !== undefined && value !== next[field]) {
            next[field] = value
            changed = true
        }
    }
    return changed ? next : indicator
}

/**
 * `framework` with `overrides` ({ [code]: { target, targetLower, targetUpper } })
 * folded in. Returns the framework itself when nothing changes, so callers can
 * use it as a memo dependency without rebuilding the tree on every render.
 */
export const applyTargets = (framework, overrides) => {
    if (!framework || !overrides || !Object.keys(overrides).length) {
        return framework
    }

    let touched = false
    const objectives = framework.objectives.map((objective) => {
        let objectiveTouched = false
        const indicators = objective.indicators.map((indicator) => {
            const next = applyToIndicator(indicator, overrides[indicator.code])
            if (next !== indicator) {
                objectiveTouched = true
            }
            return next
        })
        if (!objectiveTouched) {
            return objective
        }
        touched = true
        return { ...objective, indicators }
    })

    return touched ? { ...framework, objectives } : framework
}

/**
 * The overrides stored for one year and one tool. The store is keyed year first
 * because a year is what an administrator opens, and the two tools are edited
 * side by side within it.
 */
export const targetsFor = (store, year, frameworkId) =>
    store?.[String(year)]?.[frameworkId] || {}

/** `store` with one tool's overrides for one year replaced. */
export const withTargets = (store, year, frameworkId, overrides) => {
    const key = String(year)
    const forYear = { ...(store?.[key] || {}) }
    if (overrides && Object.keys(overrides).length) {
        forYear[frameworkId] = overrides
    } else {
        delete forYear[frameworkId]
    }
    const next = { ...(store || {}) }
    if (Object.keys(forYear).length) {
        next[key] = forYear
    } else {
        delete next[key]
    }
    return next
}

/**
 * True when `value` differs from what the framework ships for that row. Only
 * differences are stored: a target typed back to its shipped figure stops being
 * an override, so a corrected framework in a later release still reaches it.
 */
export const isOverride = (indicator, override) => {
    if (!override) {
        return false
    }
    return ['target', 'targetLower', 'targetUpper'].some(
        (field) =>
            override[field] !== undefined &&
            override[field] !== indicator[field]
    )
}

/** Drops any row whose stored figures match the framework's own. */
export const strippedOfDefaults = (framework, overrides) => {
    const out = {}
    framework.objectives.forEach((objective) =>
        objective.indicators.forEach((indicator) => {
            const override = overrides?.[indicator.code]
            if (isOverride(indicator, override)) {
                out[indicator.code] = override
            }
        })
    )
    return out
}
