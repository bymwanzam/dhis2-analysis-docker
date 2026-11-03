import { useDataQuery } from '@dhis2/app-runtime'
import i18n from '@dhis2/d2-i18n'
import { CircularLoader, NoticeBox, Tag } from '@dhis2/ui'
import React, { useMemo } from 'react'
import {
    AUTH_ADMIN,
    AUTH_EDIT,
    AUTH_PEER_REVIEW,
    AUTH_SUPERUSER,
} from '../../lib/constants.js'
import styles from '../AdminPage.module.css'

/*
 * Every user who can reach this app, with the org unit that decides what they
 * see and the authorities that decide what they may do.
 *
 * `userRoles[authorities]` is asked for rather than the user's own effective
 * authority list, because DHIS2 grants app authorities through roles: knowing
 * that a user has GHS_ASSESSMENT_EDIT is only half an answer, and which role
 * carries it is the half an administrator acts on.
 */
const USERS_QUERY = {
    users: {
        resource: 'users',
        params: {
            fields: [
                'id',
                'displayName',
                'username',
                'organisationUnits[id,displayName,level]',
                'userRoles[id,displayName,authorities]',
            ],
            paging: false,
            order: 'displayName:asc',
        },
    },
}

const LEVEL_LABEL = {
    1: () => i18n.t('National'),
    2: () => i18n.t('Regional'),
    3: () => i18n.t('District'),
}

/** The widest org unit a user holds is the one their remit follows. */
const widest = (user) => {
    const levels = (user.organisationUnits || [])
        .map((o) => o.level)
        .filter(Boolean)
    return levels.length ? Math.min(...levels) : null
}

const authoritiesOf = (user) => {
    const all = new Set()
    ;(user.userRoles || []).forEach((role) =>
        (role.authorities || []).forEach((a) => all.add(a))
    )
    return all
}

/**
 * Who can use the app, and as what.
 *
 * Read-only: users, roles and authorities are DHIS2's own, edited in the Users
 * app, and a second place to grant an authority would be a second place for a
 * permission to be wrong. What this tab answers is the question the Users app
 * cannot — of everyone on the instance, who reaches *this* app, at what level,
 * and through which role.
 */
export const UsersTab = () => {
    const { data, loading, error } = useDataQuery(USERS_QUERY)

    const rows = useMemo(() => {
        const users = data?.users?.users || []
        return users
            .map((user) => {
                const auths = authoritiesOf(user)
                const superuser = auths.has(AUTH_SUPERUSER)
                return {
                    user,
                    superuser,
                    canEdit: superuser || auths.has(AUTH_EDIT),
                    canReview: superuser || auths.has(AUTH_PEER_REVIEW),
                    canAdmin: superuser || auths.has(AUTH_ADMIN),
                    level: superuser ? 1 : widest(user),
                    roles: (user.userRoles || [])
                        .filter((role) =>
                            (role.authorities || []).some((a) =>
                                [
                                    AUTH_EDIT,
                                    AUTH_ADMIN,
                                    AUTH_SUPERUSER,
                                ].includes(a)
                            )
                        )
                        .map((role) => role.displayName),
                }
            })
            .filter((row) => row.canEdit || row.canReview || row.canAdmin)
    }, [data])

    if (loading) {
        return (
            <div className={styles.loading}>
                <CircularLoader />
            </div>
        )
    }

    if (error) {
        return (
            <NoticeBox error title={i18n.t('Could not load users')}>
                {error.message}
            </NoticeBox>
        )
    }

    return (
        <section>
            <h2 className={styles.sectionTitle}>{i18n.t('Users')}</h2>

            <div className={styles.tabHeader}>
                <Tag>
                    {i18n.t('{{count}} users can use this app', {
                        count: rows.length,
                    })}
                </Tag>
            </div>

            {rows.length === 0 ? (
                <NoticeBox
                    warning
                    title={i18n.t('Nobody holds the app authorities')}
                >
                    {i18n.t(
                        'No user role on this instance carries GHS_ASSESSMENT_EDIT, GHS_PEER_REVIEW or GHS_ASSESSMENT_ADMIN. Grant them to the relevant roles in the Users app; the app install creates all three authorities.'
                    )}
                </NoticeBox>
            ) : (
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{i18n.t('User')}</th>
                                <th>{i18n.t('Username')}</th>
                                <th>{i18n.t('Level')}</th>
                                <th>{i18n.t('Organisation unit')}</th>
                                <th>{i18n.t('Can enter data')}</th>
                                <th>{i18n.t('Can review')}</th>
                                <th>{i18n.t('Can administer')}</th>
                                <th>{i18n.t('Through role')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(
                                ({
                                    user,
                                    level,
                                    canEdit,
                                    canReview,
                                    canAdmin,
                                    superuser,
                                    roles,
                                }) => (
                                    <tr key={user.id}>
                                        <th scope="row">{user.displayName}</th>
                                        <td>{user.username}</td>
                                        <td>
                                            {superuser
                                                ? i18n.t('Superuser')
                                                : level && LEVEL_LABEL[level]
                                                  ? LEVEL_LABEL[level]()
                                                  : '—'}
                                        </td>
                                        <td>
                                            {(user.organisationUnits || [])
                                                .map((o) => o.displayName)
                                                .join(', ') || '—'}
                                        </td>
                                        <td>
                                            {canEdit ? (
                                                <Tag positive>
                                                    {i18n.t('Yes')}
                                                </Tag>
                                            ) : (
                                                <Tag>{i18n.t('No')}</Tag>
                                            )}
                                        </td>
                                        <td>
                                            {canReview ? (
                                                <Tag positive>
                                                    {i18n.t('Yes')}
                                                </Tag>
                                            ) : (
                                                <Tag>{i18n.t('No')}</Tag>
                                            )}
                                        </td>
                                        <td>
                                            {canAdmin ? (
                                                <Tag positive>
                                                    {i18n.t('Yes')}
                                                </Tag>
                                            ) : (
                                                <Tag>{i18n.t('No')}</Tag>
                                            )}
                                        </td>
                                        <td>{roles.join(', ') || '—'}</td>
                                    </tr>
                                )
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <NoticeBox title={i18n.t('Granted in DHIS2, shown here')}>
                {i18n.t(
                    'Authorities are granted to user roles in the DHIS2 Users app, not here. A user with no org unit at all gets the narrowest view rather than the widest, so an account that reaches the app but sees nothing is usually one with no organisation unit assigned.'
                )}
            </NoticeBox>
        </section>
    )
}

export default UsersTab
