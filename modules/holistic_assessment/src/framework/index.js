import framework2025District from './framework-2025-district.json'
import framework2025 from './framework-2025.json'

/**
 * Assessment frameworks, keyed by id. The 2025 framework is transcribed from
 * the official Excel scoring tool; its direction and target values come from
 * that workbook's formulas rather than its "Indicator Type" column, which
 * contradicts the formulas on a handful of rows.
 */
export const FRAMEWORKS = {
    [framework2025.id]: framework2025,
    [framework2025District.id]: framework2025District,
}

export const DEFAULT_FRAMEWORK_ID = framework2025.id
export const DISTRICT_FRAMEWORK_ID = framework2025District.id

/**
 * The regional and district tools are not the same instrument: the district
 * tool drops one Objective 1 indicator (93 vs 94) and carries its own
 * milestones, so the level decides the framework.
 */
export const frameworkIdForLevel = (level) =>
    level === 'DISTRICT' ? DISTRICT_FRAMEWORK_ID : DEFAULT_FRAMEWORK_ID

export const getFramework = (id = DEFAULT_FRAMEWORK_ID) =>
    FRAMEWORKS[id] || framework2025

/** Flat list of every indicator across all objectives, in tool order. */
export const allIndicators = (framework) =>
    framework.objectives.flatMap((o) => o.indicators)

export const allMilestones = (framework) =>
    framework.objectives.map((o) => o.milestone)

/** Total scoreable rows: 94 indicators + one milestone per objective. */
export const rowCount = (framework) =>
    allIndicators(framework).length + framework.objectives.length

const indexBy = (framework) => {
    const map = new Map()
    allIndicators(framework).forEach((i) => map.set(i.code, i))
    return map
}

const caches = new WeakMap()

export const indicatorByCode = (framework, code) => {
    if (!caches.has(framework)) {
        caches.set(framework, indexBy(framework))
    }
    return caches.get(framework).get(code)
}

/** How an indicator's target reads in the UI. */
export const targetLabel = (indicator) => {
    if (indicator.targetLower !== null && indicator.targetUpper !== null) {
        return `${indicator.targetLower} – ${indicator.targetUpper}`
    }
    if (indicator.target === null || indicator.target === undefined) {
        return '—'
    }
    return String(indicator.target)
}

export default FRAMEWORKS
