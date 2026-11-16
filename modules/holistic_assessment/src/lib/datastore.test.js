/**
 * The regional and district tools reuse the same indicator codes for different
 * indicators, so indicator mapping is stored per framework. These tests pin
 * that behaviour, including the migration from the original flat shape and the
 * layering of the DHIS2 bindings the app ships under whatever an administrator
 * saved.
 */
import * as serverPermissions from '../../server/permissions.js'
import {
    DEFAULT_FRAMEWORK_ID,
    DISTRICT_FRAMEWORK_ID,
    allIndicators,
    getFramework,
} from '../framework/index.js'
import { builtinIdsFor } from '../framework/indicator-ids.js'
import {
    AUTH_ADMIN,
    AUTH_EDIT,
    AUTH_PEER_REVIEW,
    AUTH_SUPERUSER,
    LEVEL,
    STATUS,
} from './constants.js'
import {
    assessmentKey,
    emptyAssessment,
    mappingForFramework,
    storedMappingForFramework,
    strippedOfBuiltins,
    withFrameworkMapping,
    withHistory,
} from './datastore.js'
import {
    ownsOrgUnit as browserOwnsOrgUnit,
    permissionsOf as browserPermissionsOf,
} from './useCurrentUser.js'

const REGIONAL_ENTRY = {
    id: 'abc123',
    name: 'Doctor to population',
    type: 'INDICATOR',
}
const DISTRICT_ENTRY = {
    id: 'xyz789',
    name: 'Physician Assistant',
    type: 'INDICATOR',
}

describe('assessmentKey', () => {
    it('is stable and namespaced by year and org unit', () => {
        expect(assessmentKey(2025, 'Ou12345')).toBe('assessment-2025-Ou12345')
    })
})

describe('emptyAssessment', () => {
    it('picks the district framework for a district assessment', () => {
        const a = emptyAssessment({
            year: 2025,
            orgUnit: { id: 'd1', displayName: 'Bongo', level: 3 },
            level: LEVEL.DISTRICT,
        })
        expect(a.frameworkId).toBe(DISTRICT_FRAMEWORK_ID)
        expect(a.status).toBe(STATUS.DRAFT)
        expect(a.orgUnit.name).toBe('Bongo')
    })

    it('picks the regional framework for a regional assessment', () => {
        const a = emptyAssessment({
            year: 2025,
            orgUnit: { id: 'r1', displayName: 'Upper East', level: 2 },
            level: LEVEL.REGION,
        })
        expect(a.frameworkId).toBe(DEFAULT_FRAMEWORK_ID)
    })

    it('tolerates a missing org unit', () => {
        expect(
            emptyAssessment({ year: 2025, level: LEVEL.REGION }).orgUnit
        ).toBeNull()
    })
})

describe('storedMappingForFramework', () => {
    it('returns an empty mapping when nothing is stored', () => {
        expect(storedMappingForFramework(null, DEFAULT_FRAMEWORK_ID)).toEqual(
            {}
        )
        expect(storedMappingForFramework({}, DEFAULT_FRAMEWORK_ID)).toEqual({})
    })

    it('reads the requested framework out of a nested mapping', () => {
        const stored = {
            [DEFAULT_FRAMEWORK_ID]: { 1.17: REGIONAL_ENTRY },
            [DISTRICT_FRAMEWORK_ID]: { 1.17: DISTRICT_ENTRY },
        }
        expect(
            storedMappingForFramework(stored, DEFAULT_FRAMEWORK_ID)['1.17']
        ).toBe(REGIONAL_ENTRY)
        expect(
            storedMappingForFramework(stored, DISTRICT_FRAMEWORK_ID)['1.17']
        ).toBe(DISTRICT_ENTRY)
    })

    it('treats a legacy flat mapping as the regional tool only', () => {
        const legacy = { 1.17: REGIONAL_ENTRY }
        expect(storedMappingForFramework(legacy, DEFAULT_FRAMEWORK_ID)).toEqual(
            legacy
        )
        // Crucially it does not leak into the district tool, where 1.17 is a
        // different indicator.
        expect(
            storedMappingForFramework(legacy, DISTRICT_FRAMEWORK_ID)
        ).toEqual({})
    })
})

describe('mappingForFramework', () => {
    it('falls back to the bindings the app ships', () => {
        const builtin = builtinIdsFor(DEFAULT_FRAMEWORK_ID)
        expect(mappingForFramework(null, DEFAULT_FRAMEWORK_ID)).toEqual(builtin)
        expect(mappingForFramework({}, DEFAULT_FRAMEWORK_ID)['1.1'].id).toBe(
            builtin['1.1'].id
        )
    })

    it('lets a saved binding override the shipped one', () => {
        const stored = { [DEFAULT_FRAMEWORK_ID]: { 1.1: REGIONAL_ENTRY } }
        expect(mappingForFramework(stored, DEFAULT_FRAMEWORK_ID)['1.1']).toBe(
            REGIONAL_ENTRY
        )
    })

    it('honours a tombstone left by the Admin page Clear button', () => {
        const stored = { [DEFAULT_FRAMEWORK_ID]: { 1.1: null } }
        expect(
            mappingForFramework(stored, DEFAULT_FRAMEWORK_ID)['1.1']
        ).toBeUndefined()
    })

    it('does not ship a district binding for a code the two tools disagree on', () => {
        // 1.17 is "Doctor to population ratio" regionally and "Physician
        // Assistant to population ratio" in a district, so only the regional
        // tool gets the shipped indicator.
        expect(builtinIdsFor(DEFAULT_FRAMEWORK_ID)['1.17']).toBeDefined()
        expect(builtinIdsFor(DISTRICT_FRAMEWORK_ID)['1.17']).toBeUndefined()
    })

    it('renumbers a shipped binding onto the district code for the same indicator', () => {
        // The district tool drops regional 1.35, so "Completeness of reporting
        // by health facilities" is regional 1.41 but district 1.40.
        const regional = builtinIdsFor(DEFAULT_FRAMEWORK_ID)['1.41']
        const district = builtinIdsFor(DISTRICT_FRAMEWORK_ID)['1.40']
        expect(district.id).toBe(regional.id)
        expect(builtinIdsFor(DISTRICT_FRAMEWORK_ID)['1.41']).toBeUndefined()
    })

    it('binds every shipped id to a code the framework actually has', () => {
        ;[DEFAULT_FRAMEWORK_ID, DISTRICT_FRAMEWORK_ID].forEach((id) => {
            const codes = new Set(
                allIndicators(getFramework(id)).map((i) => i.code)
            )
            Object.entries(builtinIdsFor(id)).forEach(([code, entry]) => {
                expect(codes.has(code)).toBe(true)
                expect(entry.id).toMatch(/^[A-Za-z][A-Za-z0-9]{10}$/)
            })
        })
    })
})

describe('strippedOfBuiltins', () => {
    it('drops entries that still match what the app ships', () => {
        const builtin = builtinIdsFor(DEFAULT_FRAMEWORK_ID)
        expect(strippedOfBuiltins(DEFAULT_FRAMEWORK_ID, builtin)).toEqual({})
    })

    it('keeps a rebinding and a tombstone', () => {
        const edited = { 1.1: REGIONAL_ENTRY, '1.10': null }
        expect(strippedOfBuiltins(DEFAULT_FRAMEWORK_ID, edited)).toEqual(edited)
    })

    it('drops a tombstone for a code that was never shipped', () => {
        // 1.2 has no built-in, so "cleared" is just its normal unmapped state.
        expect(strippedOfBuiltins(DEFAULT_FRAMEWORK_ID, { 1.2: null })).toEqual(
            {}
        )
    })
})

describe('withFrameworkMapping', () => {
    it('writes one framework without disturbing the other', () => {
        const stored = { [DEFAULT_FRAMEWORK_ID]: { 1.17: REGIONAL_ENTRY } }
        const next = withFrameworkMapping(stored, DISTRICT_FRAMEWORK_ID, {
            1.17: DISTRICT_ENTRY,
        })
        expect(next[DEFAULT_FRAMEWORK_ID]['1.17']).toBe(REGIONAL_ENTRY)
        expect(next[DISTRICT_FRAMEWORK_ID]['1.17']).toBe(DISTRICT_ENTRY)
    })

    it('migrates a legacy flat mapping under the regional framework', () => {
        const legacy = { 1.17: REGIONAL_ENTRY }
        const next = withFrameworkMapping(legacy, DISTRICT_FRAMEWORK_ID, {
            1.17: DISTRICT_ENTRY,
        })
        expect(next[DEFAULT_FRAMEWORK_ID]).toEqual(legacy)
        expect(next[DISTRICT_FRAMEWORK_ID]['1.17']).toBe(DISTRICT_ENTRY)
        expect(next['1.17']).toBeUndefined()
    })

    it('does not mutate the stored mapping', () => {
        const stored = { [DEFAULT_FRAMEWORK_ID]: { 1.1: REGIONAL_ENTRY } }
        const snapshot = JSON.stringify(stored)
        withFrameworkMapping(stored, DISTRICT_FRAMEWORK_ID, {})
        expect(JSON.stringify(stored)).toBe(snapshot)
    })
})

describe('withHistory', () => {
    it('appends without mutating', () => {
        const a = { status: STATUS.DRAFT, history: [{ action: 'CREATED' }] }
        const next = withHistory(a, { action: 'SUBMITTED', by: 'Ama' })
        expect(a.history).toHaveLength(1)
        expect(next.history).toHaveLength(2)
        expect(next.history[1].action).toBe('SUBMITTED')
        expect(next.history[1].at).toEqual(expect.any(String))
    })

    it('starts a history when there is none', () => {
        expect(withHistory({}, { action: 'X' }).history).toHaveLength(1)
    })
})

describe('browser and server agree', () => {
    // The server decides what a user may do; the browser only decides what to
    // offer. If the two drift, buttons appear that the server then refuses.
    it('on the names of the app authorities', () => {
        expect(serverPermissions.AUTH_EDIT).toBe(AUTH_EDIT)
        expect(serverPermissions.AUTH_ADMIN).toBe(AUTH_ADMIN)
        expect(serverPermissions.AUTH_PEER_REVIEW).toBe(AUTH_PEER_REVIEW)
        expect(serverPermissions.AUTH_SUPERUSER).toBe(AUTH_SUPERUSER)
    })

    it('on what each authority grants', () => {
        const cases = [
            [],
            [AUTH_EDIT],
            [AUTH_PEER_REVIEW],
            [AUTH_ADMIN],
            [AUTH_SUPERUSER],
            [AUTH_EDIT, AUTH_PEER_REVIEW],
        ]
        cases.forEach((authorities) =>
            expect(serverPermissions.permissionsOf(authorities)).toEqual(
                browserPermissionsOf(authorities)
            )
        )
    })

    it('on who owns an org unit', () => {
        const district = { id: 'D1', path: '/GH/R1/D1' }
        const users = [
            { orgUnits: [{ id: 'D1', level: 3, path: '/GH/R1/D1' }] },
            { orgUnits: [{ id: 'R1', level: 2, path: '/GH/R1' }] },
            { orgUnits: [{ id: 'R2', level: 2, path: '/GH/R2' }] },
            { orgUnits: [{ id: 'GH', level: 1, path: '/GH' }] },
        ]
        users.forEach((user) =>
            expect(serverPermissions.ownsOrgUnit(user, district)).toBe(
                browserOwnsOrgUnit(user, district)
            )
        )
        expect(users.map((u) => browserOwnsOrgUnit(u, district))).toEqual([
            true,
            true,
            false,
            false,
        ])
    })
})
