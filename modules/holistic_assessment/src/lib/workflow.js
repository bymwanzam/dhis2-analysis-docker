import i18n from '@dhis2/d2-i18n'
import {
    MIN_REVIEW_COMPLETION,
    MIN_SUBMIT_COMPLETION,
    PERIOD_STATUS,
    RECOMMENDATION,
    STATUS,
} from './constants.js'
import { withHistory } from './datastore.js'

/**
 * The assessment lifecycle from the GHS workflow guide.
 *
 *   DRAFT --submit--> SUBMITTED --review--> APPROVED
 *                                       |-> REVISION --resubmit--> SUBMITTED
 *                                       |-> REJECTED --> DRAFT
 *
 * Editing is locked everywhere except DRAFT, REJECTED, and REVISION; in
 * REVISION only the indicators the reviewer flagged may be touched.
 */

/**
 * The period a year is in. A year with nothing stored is open, so adding
 * periods to an instance that already holds assessments does not freeze every
 * past year on upgrade: an administrator opts a year in by creating its period.
 */
export const periodOf = (periods, year) => {
    const stored = periods?.[String(year)]
    return {
        status: PERIOD_STATUS.OPEN,
        createdAt: null,
        updatedAt: null,
        ...(stored || {}),
    }
}

/**
 * Closing a year stops new submissions but leaves data entry alone, so work in
 * progress is not lost the moment a deadline passes. Locking and archiving stop
 * editing too.
 */
export const periodAllowsEditing = (period) =>
    !period ||
    period.status === PERIOD_STATUS.OPEN ||
    period.status === PERIOD_STATUS.CLOSED

export const periodAllowsSubmission = (period) =>
    !period || period.status === PERIOD_STATUS.OPEN

/**
 * `period` is optional throughout: omitted, the rules behave exactly as they did
 * before periods existed, which is what keeps a caller that has not loaded them
 * — and the lifecycle tests — honest.
 */
export const isOwnerEditable = (status, period) =>
    periodAllowsEditing(period) &&
    (status === STATUS.DRAFT ||
        status === STATUS.REJECTED ||
        status === STATUS.REVISION)

/** Indicator codes the reviewer asked to be corrected. */
export const flaggedCodes = (assessment) => {
    const indicators = assessment?.review?.indicators || {}
    return Object.entries(indicators)
        .filter(
            ([, r]) =>
                r?.suggestedValue !== undefined &&
                r?.suggestedValue !== null &&
                r?.suggestedValue !== ''
        )
        .map(([code]) => code)
}

/** Can this specific indicator be edited right now? */
export const canEditIndicator = (assessment, code, period) => {
    if (!isOwnerEditable(assessment?.status, period)) {
        return false
    }
    if (assessment.status !== STATUS.REVISION) {
        return true
    }
    return flaggedCodes(assessment).includes(code)
}

export const submitBlockers = (assessment, completion, period) => {
    const blockers = []
    if (!isOwnerEditable(assessment?.status, period)) {
        blockers.push(
            i18n.t('This assessment is locked and cannot be submitted.')
        )
    }
    if (completion < MIN_SUBMIT_COMPLETION) {
        blockers.push(
            i18n.t('At least {{pct}}% must be complete before submitting.', {
                pct: Math.round(MIN_SUBMIT_COMPLETION * 100),
            })
        )
    }
    /*
     * Reported after completion, so somebody who is both incomplete and out of
     * time is told both things at once rather than fixing one to discover the
     * other.
     */
    if (!periodAllowsSubmission(period)) {
        blockers.push(
            i18n.t(
                'The {{year}} assessment period is not open for submission.',
                {
                    year: assessment?.year ?? '',
                }
            )
        )
    }
    return blockers
}

export const canSubmit = (assessment, completion, period) =>
    submitBlockers(assessment, completion, period).length === 0

/**
 * A rejected assessment starting a new round leaves its finished review
 * behind under `previousReviews`, so the next review starts clean rather than
 * passing on the strength of the old ticks. A revision keeps its review: only
 * the flagged rows change, and the reviewer recalls the review to continue.
 */
const startNewRound = (assessment) =>
    assessment.status === STATUS.REJECTED && assessment.review
        ? {
              ...assessment,
              review: null,
              previousReviews: [
                  ...(assessment.previousReviews || []),
                  assessment.review,
              ],
          }
        : assessment

export const submitForReview = (assessment, user, completion, period) => {
    if (!canSubmit(assessment, completion, period)) {
        throw new Error(i18n.t('Assessment is not ready to submit.'))
    }
    const resubmission = assessment.status === STATUS.REVISION
    return withHistory(
        {
            ...startNewRound(assessment),
            status: STATUS.SUBMITTED,
            submittedAt: new Date().toISOString(),
            submittedBy: user?.displayName || user?.username || null,
        },
        {
            by: user?.displayName || user?.username || null,
            action: resubmission ? 'RESUBMITTED' : 'SUBMITTED',
            note: i18n.t('Completion {{pct}}%', {
                pct: Math.round(completion * 100),
            }),
        }
    )
}

/** How much of a review has been filled in: verified or adjusted rows. */
export const reviewCompletion = (assessment, totalRows) => {
    const rows = assessment?.review?.indicators || {}
    const milestones = assessment?.review?.milestones || {}
    const done =
        Object.values(rows).filter((r) => r?.verified || r?.agree).length +
        Object.values(milestones).filter((r) => r?.verified || r?.agree).length
    return totalRows ? done / totalRows : 0
}

export const reviewBlockers = (assessment, completion) => {
    const blockers = []
    if (assessment?.status !== STATUS.SUBMITTED) {
        blockers.push(i18n.t('Only a submitted assessment can be reviewed.'))
    }
    if (assessment?.review?.status === 'SUBMITTED') {
        blockers.push(
            i18n.t('This review has already been submitted. Recall it to change it.')
        )
    }
    if (completion < MIN_REVIEW_COMPLETION) {
        blockers.push(
            i18n.t(
                'At least {{pct}}% of rows must be verified before submitting a review.',
                {
                    pct: Math.round(MIN_REVIEW_COMPLETION * 100),
                }
            )
        )
    }
    if (!assessment?.review?.recommendation) {
        blockers.push(i18n.t('Choose a recommendation.'))
    }
    return blockers
}

export const canSubmitReview = (assessment, completion) =>
    reviewBlockers(assessment, completion).length === 0

/**
 * Apply the reviewer's recommendation. Approve leaves the assessment locked so
 * the owner can accept or reject each suggested adjustment; revision and
 * rejection hand editing back with different amounts of freedom.
 */
export const submitReview = (assessment, user, completion) => {
    if (!canSubmitReview(assessment, completion)) {
        throw new Error(i18n.t('Review is not ready to submit.'))
    }
    const recommendation = assessment.review.recommendation
    const nextStatus =
        recommendation === RECOMMENDATION.REJECT
            ? STATUS.REJECTED
            : recommendation === RECOMMENDATION.REQUEST_REVISION
              ? STATUS.SUBMITTED // stays locked until the owner accepts the request
              : STATUS.UNDER_REVIEW

    return withHistory(
        {
            ...assessment,
            status: nextStatus,
            review: {
                ...assessment.review,
                status: 'SUBMITTED',
                submittedAt: new Date().toISOString(),
                submittedBy: user?.displayName || user?.username || null,
            },
        },
        {
            by: user?.displayName || user?.username || null,
            action: 'REVIEW_SUBMITTED',
            note: recommendation,
        }
    )
}

/** A reviewer pulling back a submitted review to correct it. */
export const recallReview = (assessment, user) =>
    withHistory(
        {
            ...assessment,
            status: STATUS.SUBMITTED,
            review: {
                ...assessment.review,
                status: 'IN_PROGRESS',
                submittedAt: null,
            },
        },
        {
            by: user?.displayName || user?.username || null,
            action: 'REVIEW_RECALLED',
        }
    )

/** Owner accepts a revision request: only flagged indicators unlock. */
export const acceptRevisionRequest = (assessment, user) =>
    withHistory(
        { ...assessment, status: STATUS.REVISION },
        {
            by: user?.displayName || user?.username || null,
            action: 'REVISION_ACCEPTED',
            note: i18n.t('{{count}} indicator(s) unlocked', {
                count: flaggedCodes(assessment).length,
            }),
        }
    )

/**
 * Owner accepts some of the reviewer's suggested scores. Accepted suggestions
 * become score overrides on the indicator values.
 */
export const applyScoreAdjustments = (assessment, codes, user) => {
    const suggestions = assessment.review?.indicators || {}
    const values = { ...assessment.values }

    codes.forEach((code) => {
        const suggested = suggestions[code]?.suggestedScore
        if (suggested === undefined || suggested === null || suggested === '') {
            return
        }
        values[code] = {
            ...(values[code] || {}),
            overrideScore: Number(suggested),
        }
    })

    const decisions = { ...(assessment.response?.decisions || {}) }
    Object.keys(suggestions).forEach((code) => {
        if (suggestions[code]?.suggestedScore === undefined) {
            return
        }
        decisions[code] = codes.includes(code) ? 'ACCEPTED' : 'REJECTED'
    })

    return withHistory(
        {
            ...assessment,
            values,
            status: STATUS.APPROVED,
            response: {
                ...(assessment.response || {}),
                decisions,
                respondedAt: new Date().toISOString(),
                respondedBy: user?.displayName || user?.username || null,
            },
        },
        {
            by: user?.displayName || user?.username || null,
            action: 'ADJUSTMENTS_APPLIED',
            note: i18n.t('{{count}} accepted', { count: codes.length }),
        }
    )
}

/** Owner rejects every suggested adjustment and keeps the original scores. */
export const rejectAllAdjustments = (assessment, user) => {
    const suggestions = assessment.review?.indicators || {}
    const decisions = {}
    Object.keys(suggestions).forEach((code) => {
        if (suggestions[code]?.suggestedScore !== undefined) {
            decisions[code] = 'REJECTED'
        }
    })
    return withHistory(
        {
            ...assessment,
            status: STATUS.APPROVED,
            response: {
                ...(assessment.response || {}),
                decisions,
                respondedAt: new Date().toISOString(),
                respondedBy: user?.displayName || user?.username || null,
            },
        },
        {
            by: user?.displayName || user?.username || null,
            action: 'ADJUSTMENTS_REJECTED',
        }
    )
}

/** A rejected assessment returns to the owner as a full draft. */
export const reopenAsDraft = (assessment, user) =>
    withHistory(
        { ...startNewRound(assessment), status: STATUS.DRAFT },
        {
            by: user?.displayName || user?.username || null,
            action: 'REOPENED',
        }
    )
