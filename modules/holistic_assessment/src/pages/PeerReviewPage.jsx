import i18n from '@dhis2/d2-i18n'
import {
    AlertBar,
    Button,
    ButtonStrip,
    CircularLoader,
    NoticeBox,
    Radio,
    Tab,
    TabBar,
    TextAreaField,
} from '@dhis2/ui'
import PropTypes from 'prop-types'
import React, { useMemo, useState } from 'react'
import ContextBar from '../components/ContextBar.jsx'
import IndicatorTable from '../components/IndicatorTable.jsx'
import MilestonePanel from '../components/MilestonePanel.jsx'
import StatusTag from '../components/StatusTag.jsx'
import SummaryPanel from '../components/SummaryPanel.jsx'
import { useAppState } from '../lib/AppState.jsx'
import {
    AUTH_PEER_REVIEW,
    LEVEL,
    RECOMMENDATION,
    RECOMMENDATION_LABEL,
    STATUS,
} from '../lib/constants.js'
import {
    mappingForFramework,
    useIndicatorMapping,
    usePeerPairings,
} from '../lib/datastore.js'
import { fmtPercent, fmtRelative } from '../lib/format.js'
import { useAssessment } from '../lib/useAssessment.js'
import { ownsOrgUnit, useCurrentUser } from '../lib/useCurrentUser.js'
import {
    useDistrictsForRegion,
    useOrgUnitsForLevel,
} from '../lib/useOrgUnits.js'
import {
    canSubmitReview,
    recallReview,
    reviewBlockers,
    reviewCompletion,
    submitReview,
} from '../lib/workflow.js'
import styles from './PeerReviewPage.module.css'

const RECOMMENDATION_HELP = {
    [RECOMMENDATION.APPROVE]: () =>
        i18n.t(
            'The owner sees your score suggestions and can accept or reject each one.'
        ),
    [RECOMMENDATION.REQUEST_REVISION]: () =>
        i18n.t(
            'The owner can unlock only the indicators you flagged with a suggested value, then resubmit to you.'
        ),
    [RECOMMENDATION.REJECT]: () =>
        i18n.t(
            'The assessment is unlocked back to draft for a substantial revision.'
        ),
}

/**
 * The visiting reviewer's workspace. Reviewers never edit indicator data; they
 * verify rows, suggest adjustments with justification, and recommend an outcome.
 *
 * The sidebar offers regional and district review as separate destinations, so
 * a `level` prop fixes which one this is and the in-page switch disappears.
 * Without it the page keeps its own switch, which is what the plain
 * `/peer-review` route still uses.
 */
export const PeerReviewPage = ({ level: fixedLevel }) => {
    const { year, setYear, regionId, setRegionId, districtId, setDistrictId } =
        useAppState()
    const user = useCurrentUser()
    const { value: allMapping } = useIndicatorMapping()

    const [chosenLevel, setLevel] = useState(LEVEL.REGION)
    const level = fixedLevel || chosenLevel
    const { orgUnits: regions } = useOrgUnitsForLevel(LEVEL.REGION)
    const { districts } = useDistrictsForRegion(regionId)

    const selectedId = level === LEVEL.DISTRICT ? districtId : regionId
    const orgUnit = useMemo(() => {
        const pool = level === LEVEL.DISTRICT ? districts : regions
        return pool.find((o) => o.id === selectedId) || null
    }, [level, districts, regions, selectedId])

    const [tab, setTab] = useState(0)
    const [alert, setAlert] = useState(null)

    /*
     * Conducting a review needs GHS_PEER_REVIEW, and the reviewer must not be
     * reviewing their own unit. Where pairings are recorded for the year, they
     * must also be the paired reviewer. The server enforces all three; this
     * decides what the screen offers and explains why.
     */
    const { value: pairings } = usePeerPairings()
    const reviewGate = useMemo(() => {
        if (!user.canReview) {
            return 'authority'
        }
        if (user.isSuperuser || !orgUnit) {
            return null
        }
        if (ownsOrgUnit(user, orgUnit)) {
            return 'own'
        }
        const forYear = pairings?.[String(year)] || {}
        if (!Object.keys(forYear).length) {
            return null
        }
        const reviewers = Object.entries(forYear)
            .filter(([, assessed]) => assessed === orgUnit.id)
            .map(([reviewer]) => reviewer)
        const within = (id) =>
            user.orgUnits.some(
                (o) =>
                    o.id === id ||
                    (o.path || '').split('/').includes(id)
            )
        return reviewers.some(within) ? null : 'unpaired'
    }, [user, orgUnit, pairings, year])
    const canReview = reviewGate === null

    const {
        assessment,
        framework,
        result,
        loading,
        error,
        setReviewEntry,
        patchReview,
        saveNow,
        autoSave,
    } = useAssessment({ year, orgUnit, level, autoSave: canReview })

    // Scoped to this record's framework: the regional and district tools reuse
    // the same codes for different indicators.
    const mapping = useMemo(
        () => mappingForFramework(allMapping, assessment?.frameworkId),
        [allMapping, assessment?.frameworkId]
    )

    const totalRows = result?.totalRows ?? 0
    const completion = assessment ? reviewCompletion(assessment, totalRows) : 0
    const blockers = assessment ? reviewBlockers(assessment, completion) : []
    const reviewSubmitted = assessment?.review?.status === 'SUBMITTED'

    // Without review rights the page is still worth opening — an
    // assessment's owner comes here to read the feedback they were given — so
    // it stays readable and every control that would change the review is
    // disabled rather than hidden.
    const notify = (message, tone = 'success') =>
        setAlert({ message, tone, id: Date.now() })

    const handleSubmitReview = async () => {
        try {
            const next = submitReview(assessment, user.user, completion)
            await saveNow(next)
            notify(i18n.t('Review submitted'))
        } catch (e) {
            notify(e.message, 'critical')
        }
    }

    const handleRecall = async () => {
        try {
            const next = recallReview(assessment, user.user)
            await saveNow(next)
            notify(i18n.t('Review recalled for corrections'))
        } catch (e) {
            notify(e.message, 'critical')
        }
    }

    const handleSave = async () => {
        try {
            await saveNow()
            notify(i18n.t('Review saved'))
        } catch (e) {
            notify(e.message, 'critical')
        }
    }

    const comments = assessment?.review?.comments || {}
    const setComment =
        (field) =>
        ({ value }) => {
            if (!canReview) {
                return
            }
            patchReview({ comments: { ...comments, [field]: value } })
        }

    const guardedPatchReview = (patch) => canReview && patchReview(patch)
    const guardedReviewEntry = (code, patch, kind) =>
        canReview && setReviewEntry(code, patch, kind)

    const reviewable =
        assessment &&
        (assessment.status === STATUS.SUBMITTED ||
            assessment.status === STATUS.UNDER_REVIEW)

    return (
        <div>
            <header className={styles.header}>
                <h1 className={styles.title}>{i18n.t('Peer Review')}</h1>
                {assessment && <StatusTag status={assessment.status} />}
                {autoSave.savedAt && (
                    <span className={styles.autosave}>
                        {i18n.t('Auto-saved {{when}}', {
                            when: fmtRelative(autoSave.savedAt),
                        })}
                    </span>
                )}
            </header>

            {!fixedLevel && (
                <div className={styles.levelSwitch}>
                    <Radio
                        dense
                        name="review-level"
                        label={i18n.t('Regional assessment')}
                        checked={level === LEVEL.REGION}
                        onChange={() => setLevel(LEVEL.REGION)}
                    />
                    <Radio
                        dense
                        name="review-level"
                        label={i18n.t('District assessment')}
                        checked={level === LEVEL.DISTRICT}
                        onChange={() => setLevel(LEVEL.DISTRICT)}
                    />
                </div>
            )}

            <ContextBar
                level={level}
                year={year}
                regionId={regionId}
                districtId={districtId}
                onYearChange={setYear}
                onRegionChange={setRegionId}
                onDistrictChange={setDistrictId}
            >
                <Button
                    small
                    primary
                    disabled={
                        !assessment ||
                        !reviewable ||
                        reviewSubmitted ||
                        !canReview
                    }
                    onClick={handleSave}
                >
                    {i18n.t('Save review')}
                </Button>
                {reviewSubmitted ? (
                    <Button small disabled={!canReview} onClick={handleRecall}>
                        {i18n.t('Recall review')}
                    </Button>
                ) : (
                    <Button
                        small
                        disabled={
                            !assessment ||
                            !canReview ||
                            !canSubmitReview(assessment, completion)
                        }
                        onClick={handleSubmitReview}
                    >
                        {i18n.t('Submit review')}
                    </Button>
                )}
            </ContextBar>

            {alert && (
                <AlertBar
                    key={alert.id}
                    duration={6000}
                    success={alert.tone === 'success'}
                    critical={alert.tone === 'critical'}
                    onHidden={() => setAlert(null)}
                >
                    {alert.message}
                </AlertBar>
            )}

            {!orgUnit && (
                <NoticeBox title={i18n.t('Select the assessment to review')}>
                    {i18n.t(
                        'Choose the region or district you are paired with as the visiting reviewer.'
                    )}
                </NoticeBox>
            )}

            {orgUnit && loading && (
                <div className={styles.loading}>
                    <CircularLoader />
                </div>
            )}

            {error && (
                <NoticeBox error title={i18n.t('Could not load assessment')}>
                    {error.message}
                </NoticeBox>
            )}

            {reviewGate === 'own' && (
                <NoticeBox title={i18n.t('Read-only — this is your own assessment')}>
                    {i18n.t(
                        'Peer review is done by another region or district. You can read the review and the feedback on it here.'
                    )}
                </NoticeBox>
            )}

            {reviewGate === 'unpaired' && (
                <NoticeBox title={i18n.t('Read-only — you are not the paired reviewer')}>
                    {i18n.t(
                        'Reviewer pairings are set for {{year}}, and you are not paired to review {{name}}. Pairings are managed on the Administration page.',
                        { year, name: orgUnit?.displayName }
                    )}
                </NoticeBox>
            )}

            {reviewGate === 'authority' && (
                <NoticeBox
                    title={i18n.t('Read-only — you cannot conduct reviews')}
                >
                    {i18n.t(
                        'Conducting a peer review needs the {{auth}} authority, which your DHIS2 account does not hold. You can read the review and the feedback on it, but not change either. Ask an administrator to grant the authority to one of your user roles.',
                        { auth: AUTH_PEER_REVIEW }
                    )}
                </NoticeBox>
            )}

            {orgUnit && assessment && !loading && !reviewable && (
                <NoticeBox warning title={i18n.t('Nothing to review yet')}>
                    {i18n.t(
                        'This assessment is {{status}}. Only a submitted assessment can be peer reviewed.',
                        { status: assessment.status }
                    )}
                </NoticeBox>
            )}

            {orgUnit && assessment && result && !loading && reviewable && (
                <>
                    {reviewSubmitted && (
                        <div className={styles.notice}>
                            <NoticeBox title={i18n.t('Review submitted')}>
                                {i18n.t(
                                    'Recall the review if you need to make corrections.'
                                )}
                            </NoticeBox>
                        </div>
                    )}

                    <div className={styles.body}>
                        <section className={styles.content}>
                            <TabBar>
                                {result.objectives.map((objective, i) => (
                                    <Tab
                                        key={objective.index}
                                        selected={tab === i}
                                        onClick={() => setTab(i)}
                                    >
                                        {i18n.t('Objective {{n}}', {
                                            n: objective.index,
                                        })}
                                    </Tab>
                                ))}
                            </TabBar>

                            {result.objectives[tab] && (
                                <>
                                    <p className={styles.objectiveTitle}>
                                        {result.objectives[tab].title}
                                    </p>
                                    <IndicatorTable
                                        objective={result.objectives[tab]}
                                        mapping={mapping}
                                        mode="review"
                                        canEditCode={() => false}
                                        reviewIndicators={
                                            assessment.review?.indicators || {}
                                        }
                                        onValueChange={() => {}}
                                        onReviewChange={(code, patch) =>
                                            guardedReviewEntry(
                                                code,
                                                patch,
                                                'indicators'
                                            )
                                        }
                                    />
                                    <MilestonePanel
                                        milestone={
                                            framework.objectives[tab].milestone
                                        }
                                        row={
                                            result.objectives[tab].milestoneRow
                                        }
                                        entry={
                                            assessment.milestones[
                                                framework.objectives[tab]
                                                    .milestone.code
                                            ] || {}
                                        }
                                        editable={false}
                                        mode="review"
                                        reviewEntry={
                                            assessment.review?.milestones?.[
                                                framework.objectives[tab]
                                                    .milestone.code
                                            ]
                                        }
                                        onReviewChange={(code, patch) =>
                                            setReviewEntry(
                                                code,
                                                patch,
                                                'milestones'
                                            )
                                        }
                                    />
                                </>
                            )}

                            <div className={styles.feedback}>
                                <h2 className={styles.sectionTitle}>
                                    {i18n.t('Overall feedback')}
                                </h2>
                                <TextAreaField
                                    dense
                                    rows={3}
                                    label={i18n.t('Strengths')}
                                    value={comments.strengths || ''}
                                    disabled={!canReview}
                                    onChange={setComment('strengths')}
                                />
                                <TextAreaField
                                    dense
                                    rows={3}
                                    label={i18n.t('Areas for improvement')}
                                    value={comments.improvements || ''}
                                    disabled={!canReview}
                                    onChange={setComment('improvements')}
                                />
                                <TextAreaField
                                    dense
                                    rows={3}
                                    label={i18n.t('General observations')}
                                    value={comments.general || ''}
                                    disabled={!canReview}
                                    onChange={setComment('general')}
                                />

                                <h2 className={styles.sectionTitle}>
                                    {i18n.t('Recommendation')}
                                </h2>
                                {Object.values(RECOMMENDATION).map((r) => (
                                    <div
                                        key={r}
                                        className={styles.recommendation}
                                    >
                                        <Radio
                                            dense
                                            name="recommendation"
                                            label={RECOMMENDATION_LABEL[r]}
                                            checked={
                                                assessment.review
                                                    ?.recommendation === r
                                            }
                                            disabled={!canReview}
                                            onChange={() =>
                                                guardedPatchReview({
                                                    recommendation: r,
                                                })
                                            }
                                        />
                                        <p
                                            className={
                                                styles.recommendationHelp
                                            }
                                        >
                                            {RECOMMENDATION_HELP[r]()}
                                        </p>
                                    </div>
                                ))}

                                {blockers.length > 0 && (
                                    <NoticeBox
                                        title={i18n.t('Before submitting')}
                                    >
                                        <ul className={styles.blockerList}>
                                            {blockers.map((b) => (
                                                <li key={b}>{b}</li>
                                            ))}
                                        </ul>
                                    </NoticeBox>
                                )}

                                <ButtonStrip>
                                    <Button
                                        primary
                                        disabled={
                                            !canReview ||
                                            !canSubmitReview(
                                                assessment,
                                                completion
                                            )
                                        }
                                        onClick={handleSubmitReview}
                                    >
                                        {i18n.t('Submit recommendation')}
                                    </Button>
                                </ButtonStrip>
                            </div>
                        </section>

                        <aside className={styles.sidebar}>
                            <div className={styles.progress}>
                                <div className={styles.progressLabel}>
                                    {i18n.t('Rows verified')}
                                </div>
                                <div className={styles.progressValue}>
                                    {fmtPercent(completion, 0)}
                                </div>
                            </div>
                            <SummaryPanel result={result} />
                        </aside>
                    </div>
                </>
            )}
        </div>
    )
}

PeerReviewPage.propTypes = {
    level: PropTypes.oneOf([LEVEL.REGION, LEVEL.DISTRICT]),
}

export default PeerReviewPage
