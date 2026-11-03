/**
 * Who the signed-in user is to this app, worked out once at sign-in from their
 * DHIS2 profile.
 *
 * Permissions come from either source: a GHS_* authority held through a DHIS2
 * user role (as when the app ran inside DHIS2), or membership of a configured
 * DHIS2 user group. The result is expressed as the same GHS_* authority names
 * the frontend already understands, so its `permissionsOf` needs no change.
 */

export const AUTH_EDIT = 'GHS_ASSESSMENT_EDIT'
export const AUTH_ADMIN = 'GHS_ASSESSMENT_ADMIN'
export const AUTH_PEER_REVIEW = 'GHS_PEER_REVIEW'
export const AUTH_SUPERUSER = 'ALL'

const inAnyGroup = (userGroups, wanted) => {
    if (!wanted?.length) {
        return false
    }
    const names = new Set(wanted.map((w) => w.toLowerCase()))
    return (userGroups || []).some((g) =>
        [g.id, g.name, g.code]
            .filter(Boolean)
            .some((v) => names.has(String(v).toLowerCase()))
    )
}

/** DHIS2 authorities, plus the GHS_* ones granted through group membership. */
export const effectiveAuthorities = (me, groups) => {
    const held = new Set(me.authorities || [])
    if (inAnyGroup(me.userGroups, groups.edit)) {
        held.add(AUTH_EDIT)
    }
    if (inAnyGroup(me.userGroups, groups.review)) {
        held.add(AUTH_PEER_REVIEW)
    }
    if (inAnyGroup(me.userGroups, groups.admin)) {
        held.add(AUTH_ADMIN)
    }
    return [...held]
}

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

/** The widest org unit level a user holds: 1 national, 2 regional, 3 district. */
export const scopeOf = (user) => {
    if (user.isSuperuser) {
        return 1
    }
    const levels = (user.orgUnits || []).map((o) => o.level).filter(Boolean)
    return levels.length ? Math.min(...levels) : Infinity
}

/** The session's view of a user, built from DHIS2's `/api/me`. */
export const buildUser = (me, config) => {
    const authorities = effectiveAuthorities(me, config.groups)
    const perms = permissionsOf(authorities)
    const orgUnits = (me.organisationUnits || []).map((o) => ({
        id: o.id,
        displayName: o.displayName,
        level: o.level,
        path: o.path,
    }))
    const user = {
        id: me.id,
        username: me.username,
        displayName: me.displayName,
        authorities,
        orgUnits,
        ...perms,
    }
    return { ...user, scope: scopeOf(user) }
}

/**
 * Does the user answer for this org unit? True when they are assigned to it,
 * or to one of its ancestors below national level — a region's staff answer
 * for that region's districts too. A national assignment alone is not
 * ownership: otherwise national staff could fill in any region's assessment,
 * and could never review one.
 */
export const ownsOrgUnit = (user, orgUnit) => {
    if (!orgUnit?.path) {
        return false
    }
    const segments = new Set(orgUnit.path.split('/').filter(Boolean))
    return (user.orgUnits || []).some(
        (o) => (o.level ?? 99) >= 2 && segments.has(o.id)
    )
}

/** Is the user assigned at or below the given org unit? */
export const isWithin = (user, orgUnitId) =>
    (user.orgUnits || []).some(
        (o) =>
            o.id === orgUnitId ||
            (o.path || '').split('/').filter(Boolean).includes(orgUnitId)
    )
