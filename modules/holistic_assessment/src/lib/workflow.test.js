/** The lifecycle rules from the GHS workflow guide. */
import { PERIOD_STATUS, RECOMMENDATION, STATUS } from './constants.js'
import {
    acceptRevisionRequest,
    applyScoreAdjustments,
    canEditIndicator,
    canSubmit,
    canSubmitReview,
    flaggedCodes,
    isOwnerEditable,
    periodAllowsEditing,
    periodAllowsSubmission,
    periodOf,
    recallReview,
    rejectAllAdjustments,
    reopenAsDraft,
    reviewBlockers,
    reviewCompletion,
    submitBlockers,
    submitForReview,
    submitReview,
} from './workflow.js'

const user = { displayName: 'Ama Mensah', username: 'amensah' }

const draft = (over = {}) => ({
    status: STATUS.DRAFT,
    values: {},
    milestones: {},
    review: null,
    response: null,
    history: [],
    ...over,
})

describe('editability', () => {
    it.each([
        [STATUS.DRAFT, true],
        [STATUS.REJECTED, true],
        [STATUS.REVISION, true],
        [STATUS.SUBMITTED, false],
        [STATUS.UNDER_REVIEW, false],
        [STATUS.APPROVED, false],
    ])('%s is editable: %s', (status, expected) => {
        expect(isOwnerEditable(status)).toBe(expected)
    })

    it('unlocks every indicator in a draft', () => {
        expect(canEditIndicator(draft(), '1.1')).toBe(true)
    })

    it('unlocks only flagged indicators in revision mode', () => {
        const a = draft({
            status: STATUS.REVISION,
            review: {
                indicators: {
                    1.5: { suggestedValue: '42' },
                    1.6: { agree: true },
                },
            },
        })
        expect(flaggedCodes(a)).toEqual(['1.5'])
        expect(canEditIndicator(a, '1.5')).toBe(true)
        expect(canEditIndicator(a, '1.6')).toBe(false)
        expect(canEditIndicator(a, '2.1')).toBe(false)
    })

    it('locks everything once submitted', () => {
        expect(
            canEditIndicator(draft({ status: STATUS.SUBMITTED }), '1.1')
        ).toBe(false)
    })
})

describe('submission gate', () => {
    it('blocks below 80% completion', () => {
        expect(submitBlockers(draft(), 0.79)).toHaveLength(1)
        expect(canSubmit(draft(), 0.79)).toBe(false)
    })

    it('allows at exactly 80%', () => {
        expect(canSubmit(draft(), 0.8)).toBe(true)
    })

    it('blocks a locked assessment even when complete', () => {
        expect(canSubmit(draft({ status: STATUS.SUBMITTED }), 1)).toBe(false)
    })

    it('moves a draft to submitted and records history', () => {
        const next = submitForReview(draft(), user, 0.9)
        expect(next.status).toBe(STATUS.SUBMITTED)
        expect(next.submittedBy).toBe('Ama Mensah')
        expect(next.history.at(-1).action).toBe('SUBMITTED')
    })

    it('records a resubmission distinctly', () => {
        const a = draft({ status: STATUS.REVISION })
        expect(submitForReview(a, user, 0.9).history.at(-1).action).toBe(
            'RESUBMITTED'
        )
    })

    it('refuses to submit when the gate is not met', () => {
        expect(() => submitForReview(draft(), user, 0.1)).toThrow()
    })
})

describe('review completion and gate', () => {
    const submitted = (review) => draft({ status: STATUS.SUBMITTED, review })

    it('counts verified and agreed rows', () => {
        const a = submitted({
            indicators: { 1.1: { agree: true }, 1.2: { verified: true } },
            milestones: { MS1: { agree: true } },
        })
        expect(reviewCompletion(a, 10)).toBeCloseTo(0.3, 9)
    })

    it('is zero when nothing has been reviewed', () => {
        expect(reviewCompletion(submitted({}), 10)).toBe(0)
        expect(reviewCompletion(submitted({}), 0)).toBe(0)
    })

    it('requires a recommendation and 80% verification', () => {
        const a = submitted({ indicators: {}, recommendation: null })
        expect(reviewBlockers(a, 0.5).length).toBeGreaterThan(1)
        expect(canSubmitReview(a, 0.5)).toBe(false)

        const ready = submitted({
            indicators: {},
            recommendation: RECOMMENDATION.APPROVE,
        })
        expect(canSubmitReview(ready, 0.8)).toBe(true)
    })

    it('will not review anything that is not submitted', () => {
        const a = draft({
            status: STATUS.DRAFT,
            review: { recommendation: RECOMMENDATION.APPROVE },
        })
        expect(canSubmitReview(a, 1)).toBe(false)
    })
})

describe('review outcomes', () => {
    const readyReview = (recommendation) =>
        draft({
            status: STATUS.SUBMITTED,
            review: { indicators: {}, recommendation },
        })

    it('approve moves the assessment to under review', () => {
        const next = submitReview(readyReview(RECOMMENDATION.APPROVE), user, 1)
        expect(next.status).toBe(STATUS.UNDER_REVIEW)
        expect(next.review.status).toBe('SUBMITTED')
    })

    it('reject unlocks the assessment as rejected', () => {
        expect(
            submitReview(readyReview(RECOMMENDATION.REJECT), user, 1).status
        ).toBe(STATUS.REJECTED)
    })

    it('a revision request keeps it locked until the owner accepts', () => {
        const next = submitReview(
            readyReview(RECOMMENDATION.REQUEST_REVISION),
            user,
            1
        )
        expect(next.status).toBe(STATUS.SUBMITTED)
    })

    it('a recalled review returns to in progress', () => {
        const submittedReview = submitReview(
            readyReview(RECOMMENDATION.APPROVE),
            user,
            1
        )
        const next = recallReview(submittedReview, user)
        expect(next.status).toBe(STATUS.SUBMITTED)
        expect(next.review.status).toBe('IN_PROGRESS')
        expect(next.review.submittedAt).toBeNull()
    })
})

describe('owner response', () => {
    const withSuggestions = () =>
        draft({
            status: STATUS.UNDER_REVIEW,
            values: { 1.1: { current: 10 }, 1.2: { current: 20 } },
            review: {
                indicators: {
                    1.1: { suggestedScore: 1, justification: 'overstated' },
                    1.2: { suggestedScore: -1, justification: 'unsupported' },
                },
            },
        })

    it('accepting an adjustment writes a score override', () => {
        const next = applyScoreAdjustments(withSuggestions(), ['1.1'], user)
        expect(next.values['1.1'].overrideScore).toBe(1)
        expect(next.values['1.1'].current).toBe(10)
        expect(next.values['1.2'].overrideScore).toBeUndefined()
        expect(next.response.decisions).toEqual({
            1.1: 'ACCEPTED',
            1.2: 'REJECTED',
        })
        expect(next.status).toBe(STATUS.APPROVED)
    })

    it('rejecting all keeps the original scores', () => {
        const next = rejectAllAdjustments(withSuggestions(), user)
        expect(next.values['1.1'].overrideScore).toBeUndefined()
        expect(Object.values(next.response.decisions)).toEqual([
            'REJECTED',
            'REJECTED',
        ])
        expect(next.status).toBe(STATUS.APPROVED)
    })

    it('accepting a revision request enters revision mode', () => {
        const a = draft({
            status: STATUS.SUBMITTED,
            review: { indicators: { 1.5: { suggestedValue: '42' } } },
        })
        const next = acceptRevisionRequest(a, user)
        expect(next.status).toBe(STATUS.REVISION)
        expect(next.history.at(-1).action).toBe('REVISION_ACCEPTED')
    })

    it('reopening a rejected assessment returns it to draft', () => {
        const next = reopenAsDraft(draft({ status: STATUS.REJECTED }), user)
        expect(next.status).toBe(STATUS.DRAFT)
    })
})

describe('assessment periods', () => {
    it('treats a year with nothing stored as open', () => {
        expect(periodOf({}, 2025).status).toBe(PERIOD_STATUS.OPEN)
        expect(periodOf(undefined, 2025).status).toBe(PERIOD_STATUS.OPEN)
        expect(periodOf(null, 2025).status).toBe(PERIOD_STATUS.OPEN)
    })

    it('finds a stored period whether the year is a number or a string', () => {
        const periods = { 2025: { status: PERIOD_STATUS.LOCKED } }
        expect(periodOf(periods, 2025).status).toBe(PERIOD_STATUS.LOCKED)
        expect(periodOf(periods, '2025').status).toBe(PERIOD_STATUS.LOCKED)
    })

    it.each([
        [PERIOD_STATUS.OPEN, true, true],
        [PERIOD_STATUS.CLOSED, true, false],
        [PERIOD_STATUS.LOCKED, false, false],
        [PERIOD_STATUS.ARCHIVED, false, false],
    ])(
        '%s allows editing: %s, submission: %s',
        (status, editing, submission) => {
            const period = { status }
            expect(periodAllowsEditing(period)).toBe(editing)
            expect(periodAllowsSubmission(period)).toBe(submission)
        }
    )

    it('allows everything when no period is passed at all', () => {
        expect(periodAllowsEditing(undefined)).toBe(true)
        expect(periodAllowsSubmission(undefined)).toBe(true)
        expect(isOwnerEditable(STATUS.DRAFT)).toBe(true)
        expect(canSubmit(draft(), 1)).toBe(true)
    })

    it('stops a closed year being submitted into, but not edited', () => {
        const period = { status: PERIOD_STATUS.CLOSED }
        expect(isOwnerEditable(STATUS.DRAFT, period)).toBe(true)
        expect(canEditIndicator(draft(), '1.1', period)).toBe(true)
        expect(canSubmit(draft(), 1, period)).toBe(false)
        expect(submitBlockers(draft(), 1, period)).toEqual([
            expect.stringContaining('not open for submission'),
        ])
    })

    it('stops a locked year being edited or submitted', () => {
        const period = { status: PERIOD_STATUS.LOCKED }
        expect(isOwnerEditable(STATUS.DRAFT, period)).toBe(false)
        expect(canEditIndicator(draft(), '1.1', period)).toBe(false)
        expect(canSubmit(draft(), 1, period)).toBe(false)
    })

    it('reports incompleteness and a shut period together, not one at a time', () => {
        const blockers = submitBlockers(draft(), 0.1, {
            status: PERIOD_STATUS.CLOSED,
        })
        expect(blockers).toHaveLength(2)
        expect(blockers[0]).toContain('80%')
        expect(blockers[1]).toContain('not open for submission')
    })

    it('never lets an open period unlock an already-submitted assessment', () => {
        const submitted = draft({ status: STATUS.SUBMITTED })
        const period = { status: PERIOD_STATUS.OPEN }
        expect(isOwnerEditable(STATUS.SUBMITTED, period)).toBe(false)
        expect(canSubmit(submitted, 1, period)).toBe(false)
    })
})
