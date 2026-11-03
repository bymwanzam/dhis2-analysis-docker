import { useCallback } from 'react'
import { getFramework } from '../framework/index.js'
import { applyTargets, targetsFor } from '../framework/targets.js'
import { useTargets } from './datastore.js'

/**
 * The framework an assessment should be scored against, with the year's target
 * overrides folded in.
 *
 * Four places score assessments — the assessment form, the dashboard, reports
 * and the dashboard plugin — and every one of them has to apply the same
 * targets, or the same record would score differently depending on which screen
 * was looking at it. So they all resolve their framework through here rather
 * than calling `getFramework` directly.
 *
 * The resolver is returned rather than a framework, because a page scores many
 * records at once and each carries its own `frameworkId`: a region's is the
 * regional tool, a district's the district one.
 *
 * With no overrides stored for the year, `applyTargets` hands back the very
 * same framework object, so this costs one dataStore read and nothing else.
 */
export const useScoringFramework = (year) => {
    const { value: store, loading } = useTargets()

    const resolve = useCallback(
        (frameworkId) => {
            const framework = getFramework(frameworkId)
            return applyTargets(
                framework,
                targetsFor(store, year, framework.id)
            )
        },
        [store, year]
    )

    return { resolve, loading }
}

export default useScoringFramework
