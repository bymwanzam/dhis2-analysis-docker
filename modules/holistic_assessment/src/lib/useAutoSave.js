import { useCallback, useEffect, useRef, useState } from 'react'
import { AUTOSAVE_INTERVAL_MS } from './constants.js'

/**
 * Periodically persist a working draft while the user edits.
 *
 * The app's help promises a save every 30 seconds plus an "Auto-saved"
 * timestamp, so the hook reports its own state rather than saving silently.
 * Saves are skipped while one is in flight and while nothing has changed.
 */
export const useAutoSave = ({
    value,
    save,
    enabled = true,
    interval = AUTOSAVE_INTERVAL_MS,
}) => {
    const [savedAt, setSavedAt] = useState(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [dirty, setDirty] = useState(false)

    const valueRef = useRef(value)
    const saveRef = useRef(save)
    const inFlight = useRef(false)
    const baseline = useRef(value)

    useEffect(() => {
        saveRef.current = save
    }, [save])

    useEffect(() => {
        valueRef.current = value
        if (value !== baseline.current) {
            setDirty(true)
        }
    }, [value])

    const flush = useCallback(async () => {
        if (inFlight.current || !saveRef.current) {
            return
        }
        const snapshot = valueRef.current
        if (snapshot === baseline.current) {
            return
        }
        inFlight.current = true
        setSaving(true)
        setError(null)
        try {
            await saveRef.current(snapshot)
            baseline.current = snapshot
            setSavedAt(new Date().toISOString())
            // Anything edited while the save was in flight keeps us dirty.
            setDirty(valueRef.current !== snapshot)
        } catch (e) {
            setError(e)
        } finally {
            inFlight.current = false
            setSaving(false)
        }
    }, [])

    useEffect(() => {
        if (!enabled) {
            return undefined
        }
        const id = setInterval(flush, interval)
        return () => clearInterval(id)
    }, [enabled, flush, interval])

    // Best-effort save when the tab is hidden or closed.
    useEffect(() => {
        if (!enabled) {
            return undefined
        }
        const onHide = () => {
            if (document.visibilityState === 'hidden') {
                flush()
            }
        }
        document.addEventListener('visibilitychange', onHide)
        return () => document.removeEventListener('visibilitychange', onHide)
    }, [enabled, flush])

    /** Call after an explicit save so the hook stops considering us dirty. */
    const markSaved = useCallback((snapshot) => {
        baseline.current = snapshot ?? valueRef.current
        setDirty(false)
        setSavedAt(new Date().toISOString())
    }, [])

    /** Call after (re)loading a record so the baseline is the loaded value. */
    const reset = useCallback((snapshot) => {
        baseline.current = snapshot
        valueRef.current = snapshot
        setDirty(false)
        setError(null)
    }, [])

    return { savedAt, saving, error, dirty, flush, markSaved, reset }
}

/** Warn before leaving with unsaved changes. */
export const useUnsavedWarning = (dirty) => {
    useEffect(() => {
        if (!dirty) {
            return undefined
        }
        const handler = (e) => {
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [dirty])
}
