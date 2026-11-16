import { readFileSync } from 'node:fs'
import { scoreAssessment } from '../src/lib/scoring.js'
import { isWithin, ownsOrgUnit } from './permissions.js'

/**
 * The rules every write to the store must pass, enforced here on the server.
 *
 * When the app ran inside DHIS2 these lived only in the browser, so anyone who
 * could reach the DHIS2 datastore API could skip them. Now the browser's checks
 * are a convenience and these are the authority: a write that breaks a rule is
 * refused whatever sent it.
 *
 * Each rule returns `null` when the write is allowed, or `{ status, message }`.
 */

export const STATUS = {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    REVISION: 'REVISION',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
}
const RECOMMENDATION_STATUS = {
    APPROVE: STATUS.UNDER_REVIEW,
    REQUEST_REVISION: STATUS.SUBMITTED,
    REJECT: STATUS.REJECTED,
}
const OWNER_EDITABLE = new Set([STATUS.DRAFT, STATUS.REJECTED, STATUS.REVISION])
export const MIN_SUBMIT_COMPLETION = 0.8
export const MIN_REVIEW_COMPLETION = 0.8

const loadFramework = (file) =>
    JSON.parse(
        readFileSync(new URL(`../src/framework/${file}`, import.meta.url), 'utf8')
    )
const FRAMEWORKS = Object.fromEntries(
    ['framework-2025.json', 'framework-2025-district.json']
        .map(loadFramework)
        .map((f) => [f.id, f])
)
const frameworkFor = (record) =>
    FRAMEWORKS[record.frameworkId] ||
    (record.level === 'DISTRICT'
        ? FRAMEWORKS['ghs-ha-2025-district']
        : FRAMEWORKS['ghs-ha-2025'])

const deny = (status, message) => ({ status, message })
const forbidden = (message) => deny(403, message)

/** Key order differs once a record has been through Postgres' jsonb. */
const canonical = (v) => {
    if (Array.isArray(v)) {
        return `[${v.map(canonical).join(',')}]`
    }
    if (v && typeof v === 'object') {
        return `{${Object.keys(v)
            .filter((k) => v[k] !== undefined)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
            .join(',')}}`
    }
    return JSON.stringify(v ?? null)
}
const same = (a, b) => canonical(a) === canonical(b)

/** Fields a save may touch without counting as a change of substance. */
const META = new Set(['updatedAt', 'updatedBy', 'history', 'createdAt'])
/** Fields that fix which assessment this is; never changed after creation. */
const IDENTITY = ['year', 'level', 'frameworkId', 'orgUnit']

const changedFields = (before, after) =>
    [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
        .filter((k) => !META.has(k))
        .filter((k) => !same(before?.[k], after?.[k]))

const changedCodes = (before = {}, after = {}) =>
    [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (c) => !same(before[c], after[c])
    )

const isBlank = (v) => v === undefined || v === null || v === ''

export const parseAssessmentKey = (key) => {
    const m = /^assessment-(\d{4})-([A-Za-z0-9_]+)$/.exec(key)
    return m ? { year: Number(m[1]), orgUnitId: m[2] } : null
}

export const periodStatus = (periods, year) =>
    periods?.[String(year)]?.status || 'OPEN'

const flaggedCodes = (record) =>
    Object.entries(record?.review?.indicators || {})
        .filter(([, r]) => !isBlank(r?.suggestedValue))
        .map(([code]) => code)

const reviewCompletion = (record, totalRows) => {
    const done = [
        ...Object.values(record?.review?.indicators || {}),
        ...Object.values(record?.review?.milestones || {}),
    ].filter((r) => r?.verified || r?.agree).length
    return totalRows ? done / totalRows : 0
}

/** History is an audit trail: a save may add to it, never rewrite it. */
const historyIsAppendOnly = (before, after) => {
    const old = before?.history || []
    const next = after?.history || []
    return (
        Array.isArray(next) &&
        next.length >= old.length &&
        old.every((entry, i) => same(entry, next[i]))
    )
}

/**
 * Who may change the shared settings, by key. Mirrors which Administration
 * tabs each level can edit.
 */
const CONFIG_RULES = {
    settings: { maxScope: 1 },
    'indicator-mapping': { maxScope: 1 },
    periods: { maxScope: 1 },
    targets: { maxScope: 2 },
    'peer-pairings': { maxScope: 3 },
}

export const authorizeConfigWrite = (user, key) => {
    if (user.isSuperuser) {
        return null
    }
    if (!user.canAdmin) {
        return forbidden('Changing settings needs GHS_ASSESSMENT_ADMIN.')
    }
    const rule = CONFIG_RULES[key] || { maxScope: 1 }
    if (user.scope > rule.maxScope) {
        return forbidden(
            rule.maxScope === 1
                ? 'Only national administrators can change this.'
                : 'Only national and regional administrators can change this.'
        )
    }
    return null
}

export const authorizeDelete = (user) =>
    user.isSuperuser || (user.canAdmin && user.scope === 1)
        ? null
        : forbidden('Only national administrators can delete records.')

/**
 * Check one write to an assessment record.
 *
 * `orgUnit` is the assessed unit as DHIS2 reports it ({ id, level, path });
 * `periods` and `pairings` are the stored `periods` and `peer-pairings` values.
 */
export const authorizeAssessmentWrite = ({
    user,
    key,
    before,
    after,
    orgUnit,
    periods,
    pairings,
}) => {
    const parsed = parseAssessmentKey(key)
    if (!parsed) {
        return deny(400, 'Not an assessment key.')
    }
    if (!after || typeof after !== 'object' || Array.isArray(after)) {
        return deny(400, 'An assessment must be a JSON object.')
    }
    if (
        Number(after.year) !== parsed.year ||
        after.orgUnit?.id !== parsed.orgUnitId
    ) {
        return deny(400, 'The record does not match the year and org unit in its key.')
    }
    if (!Object.values(STATUS).includes(after.status)) {
        return deny(400, `Unknown status "${after.status}".`)
    }
    if (!historyIsAppendOnly(before, after)) {
        return forbidden('The assessment history can be added to but not changed.')
    }
    if (before && IDENTITY.some((f) => !same(before[f], after[f]))) {
        return forbidden('The year, level, framework and org unit of an assessment cannot be changed.')
    }
    if (user.isSuperuser) {
        return null
    }

    const changed = changedFields(before, after)
    if (changed.length === 0) {
        // Nothing but timestamps: a save with no edits. Harmless.
        return user.canEdit || user.canReview
            ? null
            : forbidden('You do not have permission to change assessments.')
    }
    return changed.includes('review') && !closesReview(before, after)
        ? reviewerWrite({ user, parsed, before, after, changed, orgUnit, pairings })
        : ownerWrite({ user, parsed, before, after, changed, orgUnit, periods })
}

/**
 * Taking a rejected assessment into a new round — reopening it, or submitting
 * it again — files the finished review under `previousReviews` and starts the
 * next round clean, so a reviewer cannot pass the new submission on the
 * strength of the old ticks. That is the owner's move, not the reviewer's.
 *
 * A revision is different: only the flagged rows change, so the reviewer
 * recalls their review and keeps the rest of their verification.
 */
const closesReview = (before, after) =>
    Boolean(before?.review) &&
    after.review == null &&
    before.status === STATUS.REJECTED &&
    [STATUS.DRAFT, STATUS.SUBMITTED].includes(after.status) &&
    same(after.previousReviews, [...(before.previousReviews || []), before.review])

const reviewerWrite = ({ user, parsed, before, after, changed, orgUnit, pairings }) => {
    if (!user.canReview) {
        return forbidden('Conducting a peer review needs GHS_PEER_REVIEW.')
    }
    if (changed.some((f) => f !== 'review' && f !== 'status')) {
        return forbidden('A review cannot change the assessment’s own data.')
    }
    if (ownsOrgUnit(user, orgUnit)) {
        return forbidden('You cannot review the assessment of your own region or district.')
    }
    const forYear = pairings?.[String(parsed.year)] || {}
    if (Object.keys(forYear).length) {
        const reviewers = Object.entries(forYear)
            .filter(([, assessed]) => assessed === parsed.orgUnitId)
            .map(([reviewer]) => reviewer)
        if (!reviewers.length) {
            return forbidden(`No reviewer is paired with this org unit for ${parsed.year}.`)
        }
        if (!reviewers.some((r) => isWithin(user, r))) {
            return forbidden('You are not the paired reviewer for this org unit.')
        }
    }
    if (!before) {
        return deny(409, 'There is no submitted assessment to review.')
    }

    const prev = before.status
    const next = after.status
    const wasSubmitted = before.review?.status === 'SUBMITTED'
    const nowSubmitted = after.review?.status === 'SUBMITTED'

    // Recall: the reviewer takes back a submitted review to correct it.
    if (wasSubmitted && !nowSubmitted) {
        const recallable = [STATUS.SUBMITTED, STATUS.UNDER_REVIEW, STATUS.REJECTED]
        return recallable.includes(prev) && next === STATUS.SUBMITTED
            ? null
            : deny(409, 'The owner has already acted on this review; it can no longer be recalled.')
    }
    if (wasSubmitted) {
        return deny(409, 'This review has already been submitted. Recall it before changing it.')
    }
    if (prev !== STATUS.SUBMITTED) {
        return deny(409, 'Only a submitted assessment can be reviewed.')
    }
    if (!nowSubmitted) {
        return next === prev
            ? null
            : forbidden('The assessment status changes only when the review is submitted.')
    }

    // Submitting the review.
    const recommendation = after.review?.recommendation
    if (!RECOMMENDATION_STATUS[recommendation]) {
        return deny(400, 'Choose a recommendation before submitting the review.')
    }
    if (next !== RECOMMENDATION_STATUS[recommendation]) {
        return deny(400, 'The assessment status does not match the recommendation.')
    }
    const totalRows = scoreAssessment(frameworkFor(after), after.values, after.milestones).totalRows
    if (reviewCompletion(after, totalRows) < MIN_REVIEW_COMPLETION) {
        return deny(
            400,
            `At least ${MIN_REVIEW_COMPLETION * 100}% of rows must be verified before submitting a review.`
        )
    }
    return null
}

const ownerWrite = ({ user, parsed, before, after, changed, orgUnit, periods }) => {
    if (!user.canEdit) {
        return forbidden('Entering assessment data needs GHS_ASSESSMENT_EDIT.')
    }
    if (!ownsOrgUnit(user, orgUnit)) {
        return forbidden('Only the region or district being assessed can enter its data.')
    }
    const period = periodStatus(periods, parsed.year)
    const editingAllowed = period === 'OPEN' || period === 'CLOSED'
    const prev = before?.status ?? null
    const next = after.status

    if (!before) {
        if (next !== STATUS.DRAFT) {
            return forbidden('A new assessment starts as a draft.')
        }
        return editingAllowed
            ? null
            : forbidden(`The ${parsed.year} assessment period is ${period.toLowerCase()}.`)
    }

    // Data entry, with or without submitting.
    if (OWNER_EDITABLE.has(prev)) {
        const allowedNext = prev === STATUS.REJECTED
            ? [STATUS.REJECTED, STATUS.DRAFT, STATUS.SUBMITTED]
            : [prev, STATUS.SUBMITTED]
        if (!allowedNext.includes(next)) {
            return forbidden('That status change is not allowed.')
        }
        if (!editingAllowed) {
            return forbidden(`The ${parsed.year} assessment period is ${period.toLowerCase()}; editing is closed.`)
        }
        if (prev === STATUS.REVISION) {
            const flagged = new Set(flaggedCodes(before))
            const outside = changedCodes(before.values, after.values).filter(
                (c) => !flagged.has(c)
            )
            if (outside.length) {
                return forbidden(
                    `During a revision only the indicators the reviewer flagged may change (not ${outside.join(', ')}).`
                )
            }
        }
        if (next === STATUS.SUBMITTED) {
            if (period !== 'OPEN') {
                return forbidden(`The ${parsed.year} assessment period is not open for submission.`)
            }
            const { completion } = scoreAssessment(
                frameworkFor(after),
                after.values,
                after.milestones
            )
            if (completion < MIN_SUBMIT_COMPLETION) {
                return deny(
                    400,
                    `At least ${MIN_SUBMIT_COMPLETION * 100}% must be complete before submitting (this is ${Math.round(completion * 100)}%).`
                )
            }
        }
        return null
    }

    // Responding to a submitted review. The data itself stays as it was.
    const review = before.review || {}
    if (prev === STATUS.SUBMITTED && next === STATUS.REVISION) {
        if (review.status !== 'SUBMITTED' || review.recommendation !== 'REQUEST_REVISION') {
            return forbidden('No revision has been requested.')
        }
        return changed.every((f) => f === 'status')
            ? null
            : forbidden('Accepting a revision request cannot change the data.')
    }
    if (prev === STATUS.UNDER_REVIEW && next === STATUS.APPROVED) {
        if (review.status !== 'SUBMITTED' || review.recommendation !== 'APPROVE') {
            return forbidden('The review has not recommended approval.')
        }
        if (changed.some((f) => !['status', 'response', 'values'].includes(f))) {
            return forbidden('Responding to a review cannot change the data.')
        }
        // Accepted adjustments arrive as score overrides, and only those.
        const suggestions = review.indicators || {}
        for (const code of changedCodes(before.values, after.values)) {
            const { overrideScore, ...rest } = after.values?.[code] || {}
            const { overrideScore: _old, ...restBefore } = before.values?.[code] || {}
            const suggested = suggestions[code]?.suggestedScore
            if (
                !same(rest, restBefore) ||
                isBlank(suggested) ||
                Number(overrideScore) !== Number(suggested)
            ) {
                return forbidden(`Indicator ${code} can only take the reviewer’s suggested score.`)
            }
        }
        return null
    }
    return forbidden(
        prev === STATUS.SUBMITTED || prev === STATUS.UNDER_REVIEW
            ? 'This assessment is with its reviewer and cannot be edited.'
            : 'This assessment is locked.'
    )
}
