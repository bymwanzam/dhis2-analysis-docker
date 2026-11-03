/** Which DHIS2 authority grants what, and how far a user's remit reaches. */
import {
    AUTH_ADMIN,
    AUTH_EDIT,
    AUTH_PEER_REVIEW,
    AUTH_SUPERUSER,
} from './constants.js'
import { ORG_LEVEL, permissionsOf, scopeOf } from './useCurrentUser.js'

describe('permissions', () => {
    it('grants nothing to an account holding no app authority', () => {
        expect(permissionsOf([])).toEqual({
            isSuperuser: false,
            canEdit: false,
            canReview: false,
            canAdmin: false,
        })
        expect(permissionsOf()).toEqual(permissionsOf([]))
    })

    it('ignores authorities that belong to other apps', () => {
        expect(
            permissionsOf(['F_DATAVALUE_ADD', 'M_dhis-web-dashboard'])
        ).toEqual(permissionsOf([]))
    })

    it.each([
        [AUTH_EDIT, 'canEdit'],
        [AUTH_PEER_REVIEW, 'canReview'],
        [AUTH_ADMIN, 'canAdmin'],
    ])('%s grants %s and nothing else', (authority, granted) => {
        const permissions = permissionsOf([authority])
        expect(permissions[granted]).toBe(true)
        Object.entries(permissions)
            .filter(([key]) => key !== granted)
            .forEach(([, value]) => expect(value).toBe(false))
    })

    it('lets a superuser past every check', () => {
        expect(permissionsOf([AUTH_SUPERUSER])).toEqual({
            isSuperuser: true,
            canEdit: true,
            canReview: true,
            canAdmin: true,
        })
    })

    /*
     * The three are independent by design: the point of peer review is that
     * somebody other than the author looks at it, so a reviewer often should
     * not be able to enter data on the assessment they are reviewing.
     */
    it('keeps reviewing and data entry independent', () => {
        expect(permissionsOf([AUTH_PEER_REVIEW]).canEdit).toBe(false)
        expect(permissionsOf([AUTH_EDIT]).canReview).toBe(false)
        const both = permissionsOf([AUTH_EDIT, AUTH_PEER_REVIEW])
        expect(both.canEdit).toBe(true)
        expect(both.canReview).toBe(true)
        expect(both.canAdmin).toBe(false)
    })
})

describe('scope', () => {
    const at = (...levels) => ({
        isSuperuser: false,
        orgUnits: levels.map((level) => ({ level })),
    })

    it('follows the widest org unit a user holds', () => {
        expect(scopeOf(at(1))).toBe(ORG_LEVEL.NATIONAL)
        expect(scopeOf(at(2))).toBe(ORG_LEVEL.REGIONAL)
        expect(scopeOf(at(3))).toBe(ORG_LEVEL.DISTRICT)
        expect(scopeOf(at(3, 2))).toBe(ORG_LEVEL.REGIONAL)
    })

    it('treats a superuser as national whatever they are assigned', () => {
        expect(scopeOf({ isSuperuser: true, orgUnits: [{ level: 3 }] })).toBe(
            ORG_LEVEL.NATIONAL
        )
        expect(scopeOf({ isSuperuser: true, orgUnits: [] })).toBe(
            ORG_LEVEL.NATIONAL
        )
    })

    /*
     * The narrowest view rather than the widest: an account with no org unit is
     * a misconfiguration, and the safe reading of one is that it sees least.
     */
    it('gives an account with no org unit the narrowest view', () => {
        expect(scopeOf({ isSuperuser: false, orgUnits: [] })).toBe(Infinity)
        expect(scopeOf({ isSuperuser: false })).toBe(Infinity)
    })

    it('ignores an org unit DHIS2 reports without a level', () => {
        expect(
            scopeOf({
                isSuperuser: false,
                orgUnits: [{ level: null }, { level: 2 }],
            })
        ).toBe(ORG_LEVEL.REGIONAL)
    })
})
