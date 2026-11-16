import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assessmentKey, emptyAssessment, useDataStore } from './datastore.js'
import { scoreAssessment } from './scoring.js'
import { useAutoSave } from './useAutoSave.js'
import { useScoringFramework } from './useScoringFramework.js'

/**
 * Loads one assessment, exposes edit helpers, keeps a live score, and
 * auto-saves the working copy every 30 seconds.
 *
 * `autoSave` should be false for read-only viewers such as the peer reviewer
 * looking at a submitted assessment they do not own.
 */
export const useAssessment = ({ year, orgUnit, level, autoSave = true }) => {
    const store = useDataStore()
    const { resolve: resolveFramework } = useScoringFramework(year)
    const orgUnitId = orgUnit?.id || null
    const key = year && orgUnitId ? assessmentKey(year, orgUnitId) : null

    const [assessment, setAssessment] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // The stored version this copy is based on. Every write names it, and the
    // server refuses the write if somebody else has saved in the meantime.
    const version = useRef(null)
    // Saves run one after another, so an auto-save still in flight and a
    // button press never race each other with the same version.
    const queue = useRef(Promise.resolve())

    const save = useCallback(
        (next) => {
            if (!key || !next) {
                return Promise.resolve()
            }
            const run = async () => {
                const stamped = {
                    ...next,
                    updatedAt: new Date().toISOString(),
                    createdAt: next.createdAt || new Date().toISOString(),
                }
                const written = await store.write(key, stamped, {
                    version: version.current,
                })
                version.current = written.version
            }
            const result = queue.current.then(run, run)
            queue.current = result.catch(() => {})
            return result
        },
        [key, store]
    )

    const autoSaver = useAutoSave({
        value: assessment,
        save,
        enabled: autoSave && Boolean(key),
    })
    const { reset: resetAutoSave, markSaved } = autoSaver

    const load = useCallback(async () => {
        if (!key) {
            setAssessment(null)
            return
        }
        setLoading(true)
        setError(null)
        try {
            const stored = await store.readEntry(key)
            version.current = stored?.version ?? null
            const record =
                stored?.value || emptyAssessment({ year, orgUnit, level })
            setAssessment(record)
            resetAutoSave(record)
        } catch (e) {
            setError(e)
        } finally {
            setLoading(false)
        }
        // `orgUnit` is a fresh object each render; `key` already captures its id.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, store, year, level, resetAutoSave])

    useEffect(() => {
        load()
    }, [load])

    // Through the resolver, so the year's target overrides are folded in and
    // this form scores a record exactly as the dashboard and reports do.
    const framework = useMemo(
        () => resolveFramework(assessment?.frameworkId),
        [resolveFramework, assessment?.frameworkId]
    )

    const result = useMemo(
        () =>
            assessment
                ? scoreAssessment(
                      framework,
                      assessment.values,
                      assessment.milestones
                  )
                : null,
        [framework, assessment]
    )

    /** Update one field of one indicator. */
    const setValue = useCallback((code, field, value) => {
        setAssessment((prev) => {
            if (!prev) {
                return prev
            }
            const existing = prev.values[code] || {}
            const next = { ...existing, [field]: value }
            // Typing over a fetched or uploaded figure makes it a manual
            // entry again.
            if (
                (field === 'current' || field === 'previous') &&
                (existing.source === 'dhis2' || existing.source === 'upload')
            ) {
                next.source = 'manual'
            }
            return { ...prev, values: { ...prev.values, [code]: next } }
        })
    }, [])

    /** Merge fetched DHIS2 values over the current ones. */
    const mergeValues = useCallback((incoming) => {
        setAssessment((prev) =>
            prev
                ? {
                      ...prev,
                      values: Object.entries(incoming).reduce(
                          (acc, [code, patch]) => ({
                              ...acc,
                              [code]: { ...(acc[code] || {}), ...patch },
                          }),
                          { ...prev.values }
                      ),
                  }
                : prev
        )
    }, [])

    const setMilestone = useCallback((code, patch) => {
        setAssessment((prev) =>
            prev
                ? {
                      ...prev,
                      milestones: {
                          ...prev.milestones,
                          [code]: {
                              ...(prev.milestones[code] || {}),
                              ...patch,
                          },
                      },
                  }
                : prev
        )
    }, [])

    const setReviewEntry = useCallback((code, patch, group = 'indicators') => {
        setAssessment((prev) => {
            if (!prev) {
                return prev
            }
            const review = prev.review || { status: 'IN_PROGRESS' }
            const bucket = review[group] || {}
            return {
                ...prev,
                review: {
                    ...review,
                    [group]: {
                        ...bucket,
                        [code]: { ...(bucket[code] || {}), ...patch },
                    },
                },
            }
        })
    }, [])

    const patchReview = useCallback((patch) => {
        setAssessment((prev) =>
            prev
                ? { ...prev, review: { ...(prev.review || {}), ...patch } }
                : prev
        )
    }, [])

    /** Persist immediately and clear the dirty flag. */
    const saveNow = useCallback(
        async (override) => {
            const snapshot = override || assessment
            if (!snapshot) {
                return
            }
            await save(snapshot)
            if (override) {
                setAssessment(override)
            }
            markSaved(snapshot)
        },
        [assessment, save, markSaved]
    )

    return {
        assessment,
        setAssessment,
        framework,
        result,
        loading,
        error,
        reload: load,
        setValue,
        mergeValues,
        setMilestone,
        setReviewEntry,
        patchReview,
        saveNow,
        autoSave: autoSaver,
    }
}
