import i18n from '@dhis2/d2-i18n'

/** DataStore namespace holding every assessment, review and setting. */
export const NAMESPACE = 'ghs-holistic-assessment'
export const SETTINGS_KEY = 'settings'
export const MAPPING_KEY = 'indicator-mapping'
export const PAIRING_KEY = 'peer-pairings'
export const TARGETS_KEY = 'targets'
export const PERIODS_KEY = 'periods'

/** App authorities. Granted by DHIS2 role or by user group; see server/permissions.js. */
export const AUTH_EDIT = 'GHS_ASSESSMENT_EDIT'
export const AUTH_ADMIN = 'GHS_ASSESSMENT_ADMIN'
export const AUTH_PEER_REVIEW = 'GHS_PEER_REVIEW'
export const AUTH_SUPERUSER = 'ALL'

/** Assessment lifecycle, as described in the GHS workflow guide. */
export const STATUS = {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    REVISION: 'REVISION',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
}

export const STATUS_LABEL = {
    [STATUS.DRAFT]: i18n.t('Draft'),
    [STATUS.SUBMITTED]: i18n.t('Submitted'),
    [STATUS.UNDER_REVIEW]: i18n.t('Under review'),
    [STATUS.REVISION]: i18n.t('Revision requested'),
    [STATUS.APPROVED]: i18n.t('Approved'),
    [STATUS.REJECTED]: i18n.t('Rejected'),
}

/** Maps a status to a @dhis2/ui Tag colour prop. */
export const STATUS_TONE = {
    [STATUS.DRAFT]: 'default',
    [STATUS.SUBMITTED]: 'neutral',
    [STATUS.UNDER_REVIEW]: 'neutral',
    [STATUS.REVISION]: 'warning',
    [STATUS.APPROVED]: 'positive',
    [STATUS.REJECTED]: 'negative',
}

/** Peer-review recommendations and what each one does to the assessment. */
export const RECOMMENDATION = {
    APPROVE: 'APPROVE',
    REQUEST_REVISION: 'REQUEST_REVISION',
    REJECT: 'REJECT',
}

export const RECOMMENDATION_LABEL = {
    [RECOMMENDATION.APPROVE]: i18n.t('Approve'),
    [RECOMMENDATION.REQUEST_REVISION]: i18n.t('Request revision'),
    [RECOMMENDATION.REJECT]: i18n.t('Reject'),
}

export const MILESTONE_STATUS = {
    ACHIEVED: 'ACHIEVED',
    IN_PROGRESS: 'IN_PROGRESS',
    NOT_ACHIEVED: 'NOT_ACHIEVED',
}

export const MILESTONE_STATUS_LABEL = {
    [MILESTONE_STATUS.ACHIEVED]: i18n.t('Achieved'),
    [MILESTONE_STATUS.IN_PROGRESS]: i18n.t('In progress'),
    [MILESTONE_STATUS.NOT_ACHIEVED]: i18n.t('Not achieved'),
}

export const LEVEL = {
    REGION: 'REGION',
    DISTRICT: 'DISTRICT',
}

/** Org unit levels in DHIS2: 1 national, 2 region, 3 district. */
export const ORG_UNIT_LEVEL = {
    [LEVEL.REGION]: 2,
    [LEVEL.DISTRICT]: 3,
}

/**
 * An assessment year's period, which decides whether anyone may submit into it.
 *
 * A year with no period recorded is treated as OPEN, so the gate can be added
 * to an instance that already holds assessments without freezing them: an
 * administrator opts a year in by creating its period, rather than every past
 * year silently locking on upgrade.
 */
export const PERIOD_STATUS = {
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    LOCKED: 'LOCKED',
    ARCHIVED: 'ARCHIVED',
}

export const PERIOD_STATUS_LABEL = {
    [PERIOD_STATUS.OPEN]: i18n.t('Open'),
    [PERIOD_STATUS.CLOSED]: i18n.t('Closed'),
    [PERIOD_STATUS.LOCKED]: i18n.t('Locked'),
    [PERIOD_STATUS.ARCHIVED]: i18n.t('Archived'),
}

export const PERIOD_STATUS_TONE = {
    [PERIOD_STATUS.OPEN]: 'positive',
    [PERIOD_STATUS.CLOSED]: 'warning',
    [PERIOD_STATUS.LOCKED]: 'negative',
    [PERIOD_STATUS.ARCHIVED]: 'default',
}

export const PERIOD_STATUS_DESCRIPTION = {
    [PERIOD_STATUS.OPEN]: i18n.t('Owners may enter data and submit.'),
    [PERIOD_STATUS.CLOSED]: i18n.t(
        'Data entry continues, but nothing new may be submitted.'
    ),
    [PERIOD_STATUS.LOCKED]: i18n.t(
        'Neither editing nor submission is allowed; reviews already under way can still be completed.'
    ),
    [PERIOD_STATUS.ARCHIVED]: i18n.t(
        'The year is finished and kept for reference only.'
    ),
}

/** Gates taken from the workflow guide. */
export const MIN_SUBMIT_COMPLETION = 0.8
export const MIN_REVIEW_COMPLETION = 0.8
export const AUTOSAVE_INTERVAL_MS = 30000

/**
 * The five categories an assessment is reported in, on the 0-5 performance
 * scale. Ordered best first; `min` is inclusive, and the bottom category
 * catches everything below 1.
 */
export const PERFORMANCE_CATEGORY = {
    HIGH: 'HIGH',
    MODERATE: 'MODERATE',
    SUSTAINED: 'SUSTAINED',
    UNDER: 'UNDER',
    SEVERE: 'SEVERE',
}

export const PERFORMANCE_CATEGORIES = [
    { key: PERFORMANCE_CATEGORY.HIGH, min: 4 },
    { key: PERFORMANCE_CATEGORY.MODERATE, min: 3 },
    { key: PERFORMANCE_CATEGORY.SUSTAINED, min: 2 },
    { key: PERFORMANCE_CATEGORY.UNDER, min: 1 },
    { key: PERFORMANCE_CATEGORY.SEVERE, min: -Infinity },
]

export const PERFORMANCE_LABEL = {
    [PERFORMANCE_CATEGORY.HIGH]: i18n.t('Highly Performing'),
    [PERFORMANCE_CATEGORY.MODERATE]: i18n.t('Moderately Performing'),
    [PERFORMANCE_CATEGORY.SUSTAINED]: i18n.t('Sustained'),
    [PERFORMANCE_CATEGORY.UNDER]: i18n.t('Underperforming'),
    [PERFORMANCE_CATEGORY.SEVERE]: i18n.t('Severely Underperforming'),
}

export const PERFORMANCE_DESCRIPTION = {
    [PERFORMANCE_CATEGORY.HIGH]: i18n.t(
        'Exceeding most targets with positive trends'
    ),
    [PERFORMANCE_CATEGORY.MODERATE]: i18n.t(
        'Meeting most targets with stable performance'
    ),
    [PERFORMANCE_CATEGORY.SUSTAINED]: i18n.t(
        'Maintaining baseline with room for improvement'
    ),
    [PERFORMANCE_CATEGORY.UNDER]: i18n.t(
        'Below targets, intervention recommended'
    ),
    [PERFORMANCE_CATEGORY.SEVERE]: i18n.t(
        'Critical gaps requiring urgent intervention'
    ),
}

export const SCORE_LABEL = {
    '-2': i18n.t('No data / not achieved'),
    '-1': i18n.t('Declined'),
    0: i18n.t('No change'),
    1: i18n.t('Improved'),
    2: i18n.t('Target met'),
}
