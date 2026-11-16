import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { buildUser } from './permissions.js'
import {
    authorizeAssessmentWrite,
    authorizeConfigWrite,
    authorizeDelete,
} from './rules.js'

const config = { groups: { edit: ['Editors'], review: ['Reviewers'], admin: ['Admins'] } }

const person = ({ ou, level, path, authorities = [], groups = [] }) =>
    buildUser(
        {
            id: `u-${ou}`,
            username: `user-${ou}`,
            displayName: `User ${ou}`,
            authorities,
            organisationUnits: [{ id: ou, level, path }],
            userGroups: groups.map((name) => ({ id: name, name })),
        },
        config
    )

// Region R1 with district D1; region R2 reviews R1.
const R1 = { id: 'R1aaaaaaaaa', level: 2, path: '/GHaaaaaaaaa/R1aaaaaaaaa' }
const R2 = { id: 'R2aaaaaaaaa', level: 2, path: '/GHaaaaaaaaa/R2aaaaaaaaa' }
const KEY = `assessment-2025-${R1.id}`

const owner = person({ ou: R1.id, level: 2, path: R1.path, authorities: ['GHS_ASSESSMENT_EDIT'] })
const ownerNoAuth = person({ ou: R1.id, level: 2, path: R1.path })
const outsider = person({ ou: R2.id, level: 2, path: R2.path, authorities: ['GHS_ASSESSMENT_EDIT'] })
const reviewer = person({ ou: R2.id, level: 2, path: R2.path, groups: ['Reviewers'] })
const ownReviewer = person({ ou: R1.id, level: 2, path: R1.path, authorities: ['GHS_PEER_REVIEW'] })
const national = person({ ou: 'GHaaaaaaaaa', level: 1, path: '/GHaaaaaaaaa', authorities: ['GHS_ASSESSMENT_ADMIN', 'GHS_ASSESSMENT_EDIT'] })
const regionalAdmin = person({ ou: R2.id, level: 2, path: R2.path, authorities: ['GHS_ASSESSMENT_ADMIN'] })
const superuser = person({ ou: R2.id, level: 2, path: R2.path, authorities: ['ALL'] })

const framework = JSON.parse(
    readFileSync(new URL('../src/framework/framework-2025.json', import.meta.url), 'utf8')
)
const allCodes = framework.objectives.flatMap((o) => o.indicators.map((i) => i.code))
const milestoneCodes = framework.objectives.map((o) => o.milestone.code)

/** Every row answered, so the completion gates pass. */
const complete = () => ({
    values: Object.fromEntries(allCodes.map((c) => [c, { current: 10, previous: 9 }])),
    milestones: Object.fromEntries(milestoneCodes.map((c) => [c, { status: 'ACHIEVED' }])),
})

const draft = (extra = {}) => ({
    version: 1,
    frameworkId: 'ghs-ha-2025',
    year: 2025,
    level: 'REGION',
    orgUnit: { id: R1.id, name: 'Region 1' },
    status: 'DRAFT',
    values: {},
    milestones: {},
    review: null,
    response: null,
    history: [],
    ...extra,
})

const verifiedReview = (extra = {}) => ({
    status: 'IN_PROGRESS',
    indicators: Object.fromEntries(allCodes.map((c) => [c, { verified: true }])),
    milestones: Object.fromEntries(milestoneCodes.map((c) => [c, { verified: true }])),
    ...extra,
})

const check = (user, before, after, extra = {}) =>
    authorizeAssessmentWrite({ user, key: KEY, before, after, orgUnit: R1, ...extra })

const allowed = (r) => assert.equal(r, null, r?.message)
const refused = (r, status = 403) => {
    assert.ok(r, 'expected the write to be refused')
    assert.equal(r.status, status, r.message)
}

describe('data entry', () => {
    it('lets the owner create and edit a draft', () => {
        allowed(check(owner, null, draft()))
        allowed(check(owner, draft(), draft({ values: { 1.1: { current: 3 } } })))
    })

    it('refuses somebody from another region', () => {
        refused(check(outsider, null, draft()))
        refused(check(outsider, draft(), draft({ values: { 1.1: { current: 3 } } })))
    })

    it('refuses an owner without the edit permission', () => {
        refused(check(ownerNoAuth, draft(), draft({ values: { 1.1: { current: 3 } } })))
    })

    it('does not treat a national assignment as ownership', () => {
        refused(check(national, draft(), draft({ values: { 1.1: { current: 3 } } })))
    })

    it('lets a superuser through', () => {
        allowed(check(superuser, draft(), draft({ values: { 1.1: { current: 3 } } })))
    })

    it('refuses a record filed under the wrong key', () => {
        refused(check(owner, null, draft({ year: 2024 })), 400)
        refused(check(owner, null, draft({ orgUnit: { id: R2.id } })), 400)
    })

    it('refuses a new record that does not start as a draft', () => {
        refused(check(owner, null, draft({ status: 'APPROVED' })))
    })

    it('refuses rewriting history', () => {
        const before = draft({ history: [{ at: 't', action: 'SUBMITTED' }] })
        refused(check(owner, before, draft({ history: [] })))
        allowed(check(owner, before, draft({ history: [...before.history, { at: 'u', action: 'X' }] })))
    })

    it('ignores key order, which Postgres does not keep', () => {
        const before = draft({ values: { 1.1: { previous: 1, current: 2 } } })
        const after = draft({ values: { 1.1: { current: 2, previous: 1 } } })
        allowed(check(reviewer, before, after)) // no change of substance
    })
})

describe('periods', () => {
    const periods = (status) => ({ 2025: { status } })
    const edit = (p) => check(owner, draft(), draft({ values: { 1.1: { current: 1 } } }), { periods: periods(p) })
    const submit = (p) => check(owner, draft(complete()), draft({ ...complete(), status: 'SUBMITTED' }), { periods: periods(p) })

    it('lets a closed year be edited but not submitted', () => {
        allowed(edit('CLOSED'))
        refused(submit('CLOSED'))
    })

    it('stops editing in a locked or archived year', () => {
        refused(edit('LOCKED'))
        refused(edit('ARCHIVED'))
    })

    it('treats a year with no period as open', () => {
        allowed(edit(undefined))
        allowed(submit(undefined))
    })
})

describe('submission', () => {
    it('requires 80% completion', () => {
        refused(check(owner, draft(), draft({ status: 'SUBMITTED' })), 400)
        allowed(check(owner, draft(complete()), draft({ ...complete(), status: 'SUBMITTED' })))
    })

    it('locks the data once submitted', () => {
        const submitted = draft({ ...complete(), status: 'SUBMITTED' })
        refused(check(owner, submitted, { ...submitted, values: {} }))
        refused(check(owner, submitted, { ...submitted, status: 'DRAFT' }))
    })
})

describe('peer review', () => {
    const submitted = () => draft({ ...complete(), status: 'SUBMITTED' })

    it('lets a reviewer from elsewhere save a review in progress', () => {
        allowed(check(reviewer, submitted(), { ...submitted(), review: { status: 'IN_PROGRESS' } }))
    })

    it('refuses reviewing your own unit', () => {
        refused(check(ownReviewer, submitted(), { ...submitted(), review: { status: 'IN_PROGRESS' } }))
    })

    it('refuses a review that also changes the data', () => {
        refused(check(reviewer, submitted(), { ...submitted(), values: {}, review: { status: 'IN_PROGRESS' } }))
    })

    it('refuses reviewing a draft', () => {
        refused(check(reviewer, draft(), draft({ review: { status: 'IN_PROGRESS' } })), 409)
    })

    it('enforces pairings once a year has them', () => {
        const write = (pairings) =>
            check(reviewer, submitted(), { ...submitted(), review: { status: 'IN_PROGRESS' } }, { pairings })
        allowed(write({ 2025: { [R2.id]: R1.id } }))
        refused(write({ 2025: { 'R3aaaaaaaaa': R1.id } }))
        refused(write({ 2025: { [R2.id]: 'R3aaaaaaaaa' } }))
        allowed(write({ 2024: { 'R3aaaaaaaaa': R1.id } })) // other years do not count
    })

    it('submits only with 80% verified, a recommendation, and the matching status', () => {
        const before = { ...submitted(), review: verifiedReview() }
        const submit = (review, status) =>
            check(reviewer, before, { ...submitted(), status, review: { ...before.review, ...review } })
        allowed(submit({ status: 'SUBMITTED', recommendation: 'APPROVE' }, 'UNDER_REVIEW'))
        allowed(submit({ status: 'SUBMITTED', recommendation: 'REJECT' }, 'REJECTED'))
        allowed(submit({ status: 'SUBMITTED', recommendation: 'REQUEST_REVISION' }, 'SUBMITTED'))
        refused(submit({ status: 'SUBMITTED', recommendation: 'APPROVE' }, 'APPROVED'), 400)
        refused(submit({ status: 'SUBMITTED' }, 'UNDER_REVIEW'), 400)
        refused(
            check(reviewer, submitted(), {
                ...submitted(),
                status: 'UNDER_REVIEW',
                review: { status: 'SUBMITTED', recommendation: 'APPROVE' },
            }),
            400
        )
    })

    it('refuses changing a submitted review without recalling it', () => {
        const done = { ...submitted(), review: verifiedReview({ status: 'SUBMITTED', recommendation: 'REQUEST_REVISION' }) }
        refused(check(reviewer, done, { ...done, review: { ...done.review, recommendation: 'APPROVE' } }), 409)
        allowed(check(reviewer, done, { ...done, review: { ...done.review, status: 'IN_PROGRESS' } }))
    })
})

describe('responding to a review', () => {
    const reviewed = (recommendation, status) =>
        draft({
            ...complete(),
            status,
            review: verifiedReview({
                status: 'SUBMITTED',
                recommendation,
                indicators: { 1.1: { verified: true, suggestedScore: 1, suggestedValue: 12 } },
            }),
        })

    it('lets the owner accept a revision request, unlocking only flagged rows', () => {
        const before = reviewed('REQUEST_REVISION', 'SUBMITTED')
        allowed(check(owner, before, { ...before, status: 'REVISION' }))
        const revising = { ...before, status: 'REVISION' }
        allowed(check(owner, revising, { ...revising, values: { ...revising.values, 1.1: { current: 12, previous: 9 } } }))
        refused(check(owner, revising, { ...revising, values: { ...revising.values, 1.2: { current: 99 } } }))
    })

    it('lets the owner apply exactly the suggested scores on approval', () => {
        const before = reviewed('APPROVE', 'UNDER_REVIEW')
        const apply = (overrideScore) => ({
            ...before,
            status: 'APPROVED',
            response: { decisions: { 1.1: 'ACCEPTED' } },
            values: { ...before.values, 1.1: { ...before.values['1.1'], overrideScore } },
        })
        allowed(check(owner, before, apply(1)))
        refused(check(owner, before, apply(2)))
        refused(check(owner, before, { ...before, status: 'REVISION' }))
    })

    it('files the old review away when a rejected assessment is reopened', () => {
        const before = reviewed('REJECT', 'REJECTED')
        allowed(
            check(owner, before, {
                ...before,
                status: 'DRAFT',
                review: null,
                previousReviews: [before.review],
            })
        )
        // Dropping the review without filing it is the reviewer's data, not the owner's.
        refused(check(owner, before, { ...before, status: 'DRAFT', review: null }))
    })
})

describe('settings', () => {
    it('lets only national admins change national settings', () => {
        allowed(authorizeConfigWrite(national, 'periods'))
        refused(authorizeConfigWrite(regionalAdmin, 'periods'))
        refused(authorizeConfigWrite(owner, 'settings'))
    })

    it('lets regional admins change targets and pairings', () => {
        allowed(authorizeConfigWrite(regionalAdmin, 'targets'))
        allowed(authorizeConfigWrite(regionalAdmin, 'peer-pairings'))
    })

    it('lets only national admins delete', () => {
        allowed(authorizeDelete(national))
        refused(authorizeDelete(regionalAdmin))
    })
})

describe('permissions from user groups', () => {
    it('grants the review permission through the configured group', () => {
        assert.equal(reviewer.canReview, true)
        assert.ok(reviewer.authorities.includes('GHS_PEER_REVIEW'))
        assert.equal(reviewer.canEdit, false)
    })
})
