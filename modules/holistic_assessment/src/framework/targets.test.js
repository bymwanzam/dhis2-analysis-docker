/** Year-level target overrides, and how they fold into a framework. */
import {
    applyTargets,
    isOverride,
    strippedOfDefaults,
    targetsFor,
    withTargets,
} from './targets.js'
import { getFramework } from './index.js'

const framework = getFramework()

const indicator = (code) =>
    framework.objectives
        .flatMap((o) => o.indicators)
        .find((i) => i.code === code)

describe('applyTargets', () => {
    it('returns the very same framework when there is nothing to apply', () => {
        expect(applyTargets(framework, {})).toBe(framework)
        expect(applyTargets(framework, null)).toBe(framework)
        expect(applyTargets(framework, undefined)).toBe(framework)
    })

    it('returns the same framework when an override equals the shipped value', () => {
        const same = { 1.1: { target: indicator('1.1').target } }
        expect(applyTargets(framework, same)).toBe(framework)
    })

    it('replaces the target of the row it names, and only that row', () => {
        const applied = applyTargets(framework, { 1.1: { target: 99 } })
        expect(applied).not.toBe(framework)

        const all = applied.objectives.flatMap((o) => o.indicators)
        expect(all.find((i) => i.code === '1.1').target).toBe(99)

        // Every other row is untouched, object identity included.
        const untouched = all.filter((i) => i.code !== '1.1')
        untouched.forEach((i) => {
            expect(i).toBe(indicator(i.code))
        })
    })

    it('leaves objectives that contain no overridden row untouched', () => {
        const applied = applyTargets(framework, { 1.1: { target: 99 } })
        expect(applied.objectives[0]).not.toBe(framework.objectives[0])
        expect(applied.objectives[1]).toBe(framework.objectives[1])
        expect(applied.objectives[2]).toBe(framework.objectives[2])
    })

    it('carries range bounds as well as a single target', () => {
        const applied = applyTargets(framework, {
            1.1: { targetLower: 2, targetUpper: 8 },
        })
        const row = applied.objectives
            .flatMap((o) => o.indicators)
            .find((i) => i.code === '1.1')
        expect(row.targetLower).toBe(2)
        expect(row.targetUpper).toBe(8)
        // A field the override does not mention falls through unchanged.
        expect(row.target).toBe(indicator('1.1').target)
    })

    it('ignores a code the framework does not have', () => {
        expect(applyTargets(framework, { 9.99: { target: 1 } })).toBe(framework)
    })
})

describe('the store', () => {
    it('reads back what it wrote, per year and per tool', () => {
        const store = withTargets({}, 2025, framework.id, {
            1.1: { target: 5 },
        })
        expect(targetsFor(store, 2025, framework.id)).toEqual({
            1.1: { target: 5 },
        })
        expect(targetsFor(store, 2024, framework.id)).toEqual({})
        expect(targetsFor(store, 2025, 'other-tool')).toEqual({})
    })

    it('takes a year whether it is given as a number or a string', () => {
        const store = withTargets({}, 2025, framework.id, {
            1.1: { target: 5 },
        })
        expect(targetsFor(store, '2025', framework.id)).toEqual({
            1.1: { target: 5 },
        })
    })

    it('keeps the two tools apart within one year', () => {
        let store = withTargets({}, 2025, 'tool-a', { 1.1: { target: 1 } })
        store = withTargets(store, 2025, 'tool-b', { 1.1: { target: 2 } })
        expect(targetsFor(store, 2025, 'tool-a')).toEqual({
            1.1: { target: 1 },
        })
        expect(targetsFor(store, 2025, 'tool-b')).toEqual({
            1.1: { target: 2 },
        })
    })

    it('drops a tool, and then the year, when the last override goes', () => {
        let store = withTargets({}, 2025, 'tool-a', { 1.1: { target: 1 } })
        store = withTargets(store, 2025, 'tool-b', { 1.1: { target: 2 } })

        store = withTargets(store, 2025, 'tool-a', {})
        expect(store['2025']).toBeDefined()
        expect(store['2025']['tool-a']).toBeUndefined()

        store = withTargets(store, 2025, 'tool-b', {})
        expect(store['2025']).toBeUndefined()
    })

    it('does not mutate the store it was given', () => {
        const store = withTargets({}, 2025, framework.id, {
            1.1: { target: 5 },
        })
        const before = JSON.stringify(store)
        withTargets(store, 2026, framework.id, { 1.1: { target: 7 } })
        expect(JSON.stringify(store)).toBe(before)
    })
})

describe('only differences are stored', () => {
    it('does not count a figure equal to the shipped one as an override', () => {
        expect(
            isOverride(indicator('1.1'), { target: indicator('1.1').target })
        ).toBe(false)
        expect(isOverride(indicator('1.1'), { target: 99 })).toBe(true)
        expect(isOverride(indicator('1.1'), {})).toBe(false)
        expect(isOverride(indicator('1.1'), null)).toBe(false)
    })

    it('strips rows that match the framework, so a later release reaches them', () => {
        const cleaned = strippedOfDefaults(framework, {
            1.1: { target: indicator('1.1').target },
            1.2: { target: 42 },
            9.99: { target: 1 },
        })
        expect(cleaned).toEqual({ 1.2: { target: 42 } })
    })
})

describe('scoring is unchanged until a target is edited', () => {
    it('leaves every shipped target in place for an empty store', () => {
        const applied = applyTargets(
            framework,
            targetsFor({}, 2025, framework.id)
        )
        expect(applied).toBe(framework)
    })
})
