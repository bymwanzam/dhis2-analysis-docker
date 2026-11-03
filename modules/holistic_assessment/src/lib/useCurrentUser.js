import { useMemo } from 'react'
import {
    AUTH_ADMIN,
    AUTH_EDIT,
    AUTH_PEER_REVIEW,
    AUTH_SUPERUSER,
} from './constants.js'
import { useSession } from './session.jsx'

/**
 * What a list of DHIS2 authorities lets someone do in this app.
 *
 * Separated from the hook so the rule can be read and tested on its own: which
 * authority grants what is a decision, not a detail of how the current user is
 * fetched.
 *
 * Three custom authorities, one per thing a person does here — enter data,
 * review someone else's, configure the instance. They are independent: a
 * reviewer need not be able to enter data, and often should not be, since the
 * point of peer review is that somebody else looks at it. A superuser (ALL)
 * passes every check.
 */
export const permissionsOf = (authorities = []) => {
    const held = new Set(authorities)
    const isSuperuser = held.has(AUTH_SUPERUSER)
    return {
        isSuperuser,
        canEdit: isSuperuser || held.has(AUTH_EDIT),
        canReview: isSuperuser || held.has(AUTH_PEER_REVIEW),
        canAdmin: isSuperuser || held.has(AUTH_ADMIN),
    }
}

/**
 * The signed-in user, their authorities and their assigned org units.
 *
 * Read from the server's session rather than asked of DHIS2 directly: the
 * server decides what the user may do, and its list of authorities includes
 * those granted through DHIS2 user groups as well as roles.
 *
 * `canEdit` gates data entry, `canReview` conducting a peer review and
 * `canAdmin` the Administration page, matching the authorities described in the
 * app's help.
 */
export const useCurrentUser = () => {
    const session = useSession()

    return useMemo(() => {
        const me = session.user
        const authorities = me?.authorities || []

        return {
            loading: false,
            error: null,
            refetch: session.refresh,
            user: me || null,
            authorities,
            ...permissionsOf(authorities),
            orgUnits: me?.orgUnits || [],
            orgUnitIds: (me?.orgUnits || []).map((o) => o.id),
        }
    }, [session])
}

/**
 * DHIS2 org unit levels: 1 national, 2 regional, 3 district.
 */
export const ORG_LEVEL = {
    NATIONAL: 1,
    REGIONAL: 2,
    DISTRICT: 3,
}

/**
 * How far a user's remit reaches, as an org unit level: the widest org unit
 * they hold. A superuser is treated as national, and a user with no org unit at
 * all gets the narrowest view rather than the widest.
 *
 * This is what decides which dashboard a user lands on and which Admin tabs
 * they see — a national user sees the country and its regions, a regional user
 * their region and its districts, a district user their district.
 */
export const scopeOf = (user) => {
    if (user.isSuperuser) {
        return ORG_LEVEL.NATIONAL
    }
    const levels = (user.orgUnits || []).map((o) => o.level).filter(Boolean)
    return levels.length ? Math.min(...levels) : Infinity
}

/**
 * True when the user answers for this org unit: assigned to it, or to one of
 * its ancestors below national level — a region's staff answer for its
 * districts too. A national assignment alone is not ownership, so national
 * staff neither fill in a region's assessment nor are barred from reviewing
 * one. The server applies the same rule (`server/permissions.js`); this copy
 * only decides what the screen offers.
 *
 * `isSuperuser` is not consulted here: callers that let a superuser through
 * check it themselves.
 */
export const ownsOrgUnit = (user, orgUnit) => {
    if (!user || !orgUnit) {
        return false
    }
    const segments = new Set((orgUnit.path || `/${orgUnit.id}`).split('/').filter(Boolean))
    return (user.orgUnits || []).some(
        (o) => (o.level ?? 99) >= 2 && segments.has(o.id)
    )
}
