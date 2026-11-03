import i18n from '@dhis2/d2-i18n'
import { NoticeBox, Tab, TabBar } from '@dhis2/ui'
import PropTypes from 'prop-types'
import React, { useState } from 'react'
import {
    DEFAULT_FRAMEWORK_ID,
    DISTRICT_FRAMEWORK_ID,
    allIndicators,
    getFramework,
} from '../framework/index.js'
import { builtinIdsFor } from '../framework/indicator-ids.js'
import {
    AUTH_ADMIN,
    AUTH_EDIT,
    AUTH_PEER_REVIEW,
    MIN_REVIEW_COMPLETION,
    MIN_SUBMIT_COMPLETION,
    PERFORMANCE_CATEGORIES,
    PERFORMANCE_DESCRIPTION,
    PERFORMANCE_LABEL,
} from '../lib/constants.js'
import { fmtPercent } from '../lib/format.js'
import { REPORTS } from '../reports/builders.js'
import styles from './HelpPage.module.css'

const Step = ({ n, title, children }) => (
    <li className={styles.step}>
        <span className={styles.stepNumber}>{n}</span>
        <div>
            <h3 className={styles.stepTitle}>{title}</h3>
            <p className={styles.stepBody}>{children}</p>
        </div>
    </li>
)

Step.propTypes = {
    children: PropTypes.node,
    n: PropTypes.number,
    title: PropTypes.string,
}

const QuickStart = () => (
    <section>
        <p className={styles.lead}>
            {i18n.t(
                'Welcome to the GHS Holistic Assessment application. This guide will help you get started with the annual health sector performance assessment.'
            )}
        </p>
        <ol className={styles.steps}>
            <Step n={1} title={i18n.t('Select assessment year')}>
                {i18n.t(
                    'Use the year selector to choose the assessment year. Typically you will be assessing data from the previous calendar year.'
                )}
            </Step>
            <Step n={2} title={i18n.t('Navigate to assessment')}>
                {i18n.t(
                    'Click Regional Assessment in the sidebar to enter regional data, or District Assessment for district-level assessment.'
                )}
            </Step>
            <Step n={3} title={i18n.t('Select your region or district')}>
                {i18n.t(
                    'Choose your region from the dropdown. For district assessment, also select the district. The form loads any previously saved data and auto-populates available DHIS2 indicators.'
                )}
            </Step>
            <Step n={4} title={i18n.t('Enter indicator values')}>
                {i18n.t(
                    'Work through each objective tab, entering current year and previous year values for all 94 indicators. Scores are calculated as you type.'
                )}
            </Step>
            <Step n={5} title={i18n.t('Complete milestones')}>
                {i18n.t(
                    'For each objective, mark the milestone achievement and provide evidence. Milestones carry a quarter of the objective weight.'
                )}
            </Step>
            <Step n={6} title={i18n.t('Save and submit')}>
                {i18n.t(
                    'Save frequently using Save Draft. Once at least 80% complete, click Submit for Review to send it to your peer reviewer.'
                )}
            </Step>
        </ol>

        <NoticeBox title={i18n.t('Permissions')}>
            {i18n.t(
                'To edit an assessment you need the GHS_ASSESSMENT_EDIT authority in DHIS2. Users without it see assessments read-only. Contact your DHIS2 administrator if you need edit access.'
            )}
        </NoticeBox>
        <div className={styles.spacer} />
        <NoticeBox title={i18n.t('Auto-save')}>
            {i18n.t(
                'The system saves your work every 30 seconds while you are editing, and shows an "Auto-saved" timestamp. You can also save manually at any time. It is still worth saving before navigating away.'
            )}
        </NoticeBox>
    </section>
)

const Workflow = () => (
    <section>
        <h2 className={styles.h2}>{i18n.t('Roles in the workflow')}</h2>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{i18n.t('Role')}</th>
                    <th>{i18n.t('Who')}</th>
                    <th>{i18n.t('Responsibility')}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{i18n.t('Assessment owner')}</td>
                    <td>{i18n.t('The region or district being assessed')}</td>
                    <td>
                        {i18n.t(
                            'Fetch data from DHIMS2, enter remaining indicator values and milestones, and submit for peer review.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('Peer reviewer')}</td>
                    <td>{i18n.t('The visiting or paired region/district')}</td>
                    <td>
                        {i18n.t(
                            'Review the submitted assessment, verify data accuracy, suggest score adjustments, and give a recommendation.'
                        )}
                    </td>
                </tr>
            </tbody>
        </table>

        <h2 className={styles.h2}>{i18n.t('Phase 1 — Data entry (owner)')}</h2>
        <ol className={styles.steps}>
            <Step n={1} title={i18n.t('Fetch DHIS2 data')}>
                {i18n.t(
                    'Select your region or district. Mapped indicators are pulled from DHIMS2 automatically.'
                )}
            </Step>
            <Step n={2} title={i18n.t('Enter remaining indicators')}>
                {i18n.t(
                    'For indicators marked Manual, enter current and previous year values from your records, reports or registers.'
                )}
            </Step>
            <Step n={3} title={i18n.t('Complete milestones')}>
                {i18n.t(
                    'For each objective, assess the milestone status and provide supporting evidence.'
                )}
            </Step>
            <Step n={4} title={i18n.t('Save and review')}>
                {i18n.t(
                    'Save as draft and check the summary panel for your overall score, objective scores and completion.'
                )}
            </Step>
        </ol>

        <NoticeBox warning title={i18n.t('No data penalty')}>
            {i18n.t(
                'Any indicator left without data automatically scores -2, which lowers the overall assessment substantially. If data is not supplied it is assumed the region or district has not provided the required information. Always enter all available data before submitting.'
            )}
        </NoticeBox>

        <h2 className={styles.h2}>{i18n.t('Phase 2 — Submission (owner)')}</h2>
        <ul className={styles.bullets}>
            <li>{i18n.t('Click Submit for Review on the assessment page.')}</li>
            <li>{i18n.t('The status changes from Draft to Submitted.')}</li>
            <li>
                {i18n.t(
                    'The assessment locks — the owner cannot edit further until the review is resolved.'
                )}
            </li>
            <li>{i18n.t('The paired reviewer can now open it.')}</li>
        </ul>

        <h2 className={styles.h2}>
            {i18n.t('Phase 3 — Peer review (visiting reviewer)')}
        </h2>
        <p className={styles.body}>
            {i18n.t(
                'The reviewer does not enter or modify data. They review what was submitted and give feedback. Reviews auto-save every 30 seconds, and at least 80% of rows must be verified before submitting.'
            )}
        </p>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{i18n.t('Recommendation')}</th>
                    <th>{i18n.t('Meaning')}</th>
                    <th>{i18n.t('What happens next')}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{i18n.t('Approve')}</td>
                    <td>{i18n.t('Assessment is accurate and complete')}</td>
                    <td>
                        {i18n.t(
                            'The owner sees score suggestions and can accept or reject each one. Accepted adjustments are applied.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('Request revision')}</td>
                    <td>{i18n.t('Manual indicator values need correction')}</td>
                    <td>
                        {i18n.t(
                            'The owner accepts the request to enter revision mode. Only flagged indicators become editable, then they resubmit to the same reviewer.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('Reject')}</td>
                    <td>{i18n.t('Significant data quality issues')}</td>
                    <td>
                        {i18n.t(
                            'The assessment is unlocked to Draft. The owner must substantially revise and resubmit.'
                        )}
                    </td>
                </tr>
            </tbody>
        </table>

        <h2 className={styles.h2}>{i18n.t('Phase 4 — Response (owner)')}</h2>
        <ul className={styles.bullets}>
            <li>
                {i18n.t(
                    'Open the Peer Review page to see the reviewer comments, suggested adjustments and recommendation.'
                )}
            </li>
            <li>
                {i18n.t(
                    'For Approve — accept or reject individual score adjustments.'
                )}
            </li>
            <li>
                {i18n.t(
                    'For Request revision — accept the request, update the flagged indicators, then resubmit.'
                )}
            </li>
            <li>
                {i18n.t(
                    'For Reject — the assessment returns to Draft for a full revision.'
                )}
            </li>
        </ul>
    </section>
)

const Scoring = () => {
    const framework = getFramework()
    const total = allIndicators(framework).length

    return (
        <section>
            <p className={styles.lead}>
                {i18n.t(
                    'Every indicator is scored from -2 to +2. The score depends on whether data was supplied, whether the target was met, how performance changed since last year, and how far performance sits from target.'
                )}
            </p>

            <h2 className={styles.h2}>{i18n.t('Outcome scale')}</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('Score')}</th>
                        <th>{i18n.t('Meaning')}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>+2</td>
                        <td>
                            {i18n.t(
                                'Target achieved and performance improved or held steady'
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>+1</td>
                        <td>
                            {i18n.t(
                                'Target achieved with a small decline, or target missed but performance improved'
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>0</td>
                        <td>
                            {i18n.t(
                                'Target achieved but performance dropped sharply, or target missed and performance flat within 40% of target'
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>-1</td>
                        <td>
                            {i18n.t('Target missed and performance declined')}
                        </td>
                    </tr>
                    <tr>
                        <td>-2</td>
                        <td>{i18n.t('No data supplied')}</td>
                    </tr>
                </tbody>
            </table>

            <h2 className={styles.h2}>{i18n.t('The 0-5 performance scale')}</h2>
            <p className={styles.body}>
                {i18n.t(
                    'An objective can score anywhere from minus its weight to plus its weight, and the whole assessment from -{{max}} to +{{max}}. That range is rescaled onto 0-5 for reporting, so a raw score of zero - no movement at all - sits at 2.50, the floor at 0 and the ceiling at 5.',
                    { max: '3.7333' }
                )}
            </p>
            <p className={styles.body}>
                {i18n.t(
                    'Because each objective is weighted by exactly its own maximum, averaging the three objective scores and rescaling the total come to the same number. The headline can never disagree with the three figures beneath it.'
                )}
            </p>

            <h2 className={styles.h2}>{i18n.t('Performance categories')}</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('Score')}</th>
                        <th>{i18n.t('Category')}</th>
                        <th>{i18n.t('Meaning')}</th>
                    </tr>
                </thead>
                <tbody>
                    {PERFORMANCE_CATEGORIES.map((band, i) => {
                        const upper = PERFORMANCE_CATEGORIES[i - 1]
                        // The bottom category has no lower bound of its own;
                        // the scale's floor is 0, so that is what it reads as.
                        const from = Math.max(0, band.min)
                        return (
                            <tr key={band.key}>
                                <td>
                                    {upper
                                        ? `${from.toFixed(1)} – ${(
                                              upper.min - 0.01
                                          ).toFixed(2)}`
                                        : i18n.t('{{from}} and above', {
                                              from: from.toFixed(1),
                                          })}
                                </td>
                                <td>{PERFORMANCE_LABEL[band.key]}</td>
                                <td>{PERFORMANCE_DESCRIPTION[band.key]}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>

            <h2 className={styles.h2}>{i18n.t('How scores are weighted')}</h2>
            <p className={styles.body}>
                {i18n.t(
                    'Each indicator carries a weight derived from expert scoring. Within an objective, an indicator contributes its share of that objective weight.'
                )}
            </p>
            <pre className={styles.formula}>
                {`score = weight / Σweights / 2 × objectiveWeight × outcome
objectiveScore = Σ indicator scores  (bounded by ± objectiveWeight)`}
            </pre>
            <p className={styles.body}>
                {i18n.t(
                    'The milestone for each objective carries 25% of that objective weight, so it moves the score more than any single indicator.'
                )}
            </p>

            <h2 className={styles.h2}>{i18n.t('Objective weights')}</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('Objective')}</th>
                        <th>{i18n.t('Indicators')}</th>
                        <th>{i18n.t('Max score')}</th>
                    </tr>
                </thead>
                <tbody>
                    {framework.objectives.map((o) => (
                        <tr key={o.index}>
                            <td>{o.title}</td>
                            <td>{o.indicators.length}</td>
                            <td>{o.weight.toFixed(4)}</td>
                        </tr>
                    ))}
                    <tr>
                        <td>
                            <strong>{i18n.t('Total')}</strong>
                        </td>
                        <td>
                            <strong>{total}</strong>
                        </td>
                        <td>
                            <strong>
                                {framework.objectives
                                    .reduce((s, o) => s + o.weight, 0)
                                    .toFixed(4)}
                            </strong>
                        </td>
                    </tr>
                </tbody>
            </table>

            <NoticeBox title={i18n.t('Performance index')}>
                {i18n.t(
                    'Raw scores run from -3.7333 to +3.7333. The performance index rescales that onto 0-100 so a single headline number can be compared across years and org units.'
                )}
            </NoticeBox>
        </section>
    )
}

/** Objective weights are relative, so the table shows each one's share. */
const objectiveShares = (framework) => {
    const total = framework.objectives.reduce((sum, o) => sum + o.weight, 0)
    return framework.objectives.map((o) => ({
        ...o,
        share: total > 0 ? o.weight / total : 0,
    }))
}

/** Objective titles are stored with their own "Objective n:" prefix. */
const focusArea = (title) => title.replace(/^Objective \d+:\s*/, '')

const Assessment = () => {
    const regional = getFramework(DEFAULT_FRAMEWORK_ID)
    const district = getFramework(DISTRICT_FRAMEWORK_ID)
    const shares = objectiveShares(regional)
    const bound = Object.keys(builtinIdsFor(DEFAULT_FRAMEWORK_ID)).length

    return (
        <section>
            <p className={styles.lead}>
                {i18n.t(
                    'The assessment is organised into 3 strategic objectives aligned with the Health Sector Medium-Term Development Plan (HSMTDP). Each objective carries its own indicators and one milestone.'
                )}
            </p>

            <h2 className={styles.h2}>{i18n.t('Assessment structure')}</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('Objective')}</th>
                        <th>{i18n.t('Focus area')}</th>
                        <th>{i18n.t('Rows')}</th>
                        <th>{i18n.t('Weight')}</th>
                    </tr>
                </thead>
                <tbody>
                    {shares.map((o) => (
                        <tr key={o.index}>
                            <td>{i18n.t('Objective {{n}}', { n: o.index })}</td>
                            <td>{focusArea(o.title)}</td>
                            <td>
                                {i18n.t('{{count}} indicators, 1 milestone', {
                                    count: o.indicators.length,
                                })}
                            </td>
                            <td>{fmtPercent(o.share, 1)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <h2 className={styles.h2}>
                {i18n.t('Regional and district are different instruments')}
            </h2>
            <p className={styles.body}>
                {i18n.t(
                    'The two tools are not the same questionnaire, so the app ships both and picks one from the level being assessed. They also reuse the same indicator codes for different indicators, which is why nothing keyed by code is shared between them.'
                )}
            </p>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('Count')}</th>
                        <th>{i18n.t('Regional')}</th>
                        <th>{i18n.t('District')}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>{i18n.t('Indicators')}</td>
                        <td>{allIndicators(regional).length}</td>
                        <td>{allIndicators(district).length}</td>
                    </tr>
                    <tr>
                        <td>{i18n.t('Milestones')}</td>
                        <td>{regional.objectives.length}</td>
                        <td>{district.objectives.length}</td>
                    </tr>
                    <tr>
                        <td>{i18n.t('Objective 1 indicators')}</td>
                        <td>{regional.objectives[0].indicators.length}</td>
                        <td>{district.objectives[0].indicators.length}</td>
                    </tr>
                </tbody>
            </table>
            <NoticeBox title={i18n.t('Why the counts differ')}>
                {i18n.t(
                    'The district tool drops one Objective 1 indicator that only applies regionally, so its codes run one behind from that point on. 1.17 is "Doctor to population ratio" regionally but "Physician Assistant to population ratio" in a district.'
                )}
            </NoticeBox>

            <h2 className={styles.h2}>{i18n.t('Where values come from')}</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('Label')}</th>
                        <th>{i18n.t('Meaning')}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>{i18n.t('DHIS2')}</td>
                        <td>
                            {i18n.t(
                                'Bound to a DHIS2 indicator, so the value can be fetched from analytics. {{bound}} of the {{total}} regional rows ship already bound.',
                                { bound, total: allIndicators(regional).length }
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>{i18n.t('Manual')}</td>
                        <td>
                            {i18n.t(
                                'No DHIS2 source, so the figure is typed in from reports, registers or returns.'
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>{i18n.t('lower is better')}</td>
                        <td>
                            {i18n.t(
                                'A negative indicator, where a fall is an improvement - mortality rates, for instance. The scoring engine reverses the comparison for these.'
                            )}
                        </td>
                    </tr>
                </tbody>
            </table>

            <h2 className={styles.h2}>{i18n.t('Who can edit')}</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('DHIS2 authority')}</th>
                        <th>{i18n.t('Grants')}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>{i18n.t('None')}</td>
                        <td>{i18n.t('Read-only access to assessments')}</td>
                    </tr>
                    <tr>
                        <td>{AUTH_EDIT}</td>
                        <td>
                            {i18n.t(
                                'Enter and submit assessment data for your own region or district'
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>{AUTH_PEER_REVIEW}</td>
                        <td>
                            {i18n.t(
                                "Conduct a peer review of another region or district's assessment. Without it the peer review page is read-only"
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>{AUTH_ADMIN}</td>
                        <td>
                            {i18n.t(
                                'Open the Administration page — periods, targets, indicator mapping and the rest'
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td>{i18n.t('ALL (superuser)')}</td>
                        <td>{i18n.t('Passes every check')}</td>
                    </tr>
                </tbody>
            </table>

            <h2 className={styles.h2}>{i18n.t('Before you submit')}</h2>
            <ul className={styles.bullets}>
                <li>
                    {i18n.t(
                        'Complete at least {{pct}} of all rows. Anything left empty scores -2.',
                        { pct: fmtPercent(MIN_SUBMIT_COMPLETION, 0) }
                    )}
                </li>
                <li>
                    {i18n.t('Set a status and evidence for all 3 milestones.')}
                </li>
                <li>
                    {i18n.t(
                        'Check the summary panel - it scores live as you type.'
                    )}
                </li>
            </ul>
        </section>
    )
}

const PeerReview = () => (
    <section>
        <p className={styles.lead}>
            {i18n.t(
                'Every submitted assessment is reviewed by a peer - another region or district, paired in advance. Reviewers never edit the figures; they verify rows, suggest adjustments with a justification, and recommend an outcome.'
            )}
        </p>

        <NoticeBox title={i18n.t('Who may review')}>
            {i18n.t(
                'Conducting a review needs the {{auth}} authority. Anyone without it can still open the page and read a review and its feedback, but cannot change either — which is how the assessment’s own owner reads what their reviewer said.',
                { auth: AUTH_PEER_REVIEW }
            )}
        </NoticeBox>

        <h2 className={styles.h2}>{i18n.t('What a reviewer does')}</h2>
        <ul className={styles.bullets}>
            <li>
                {i18n.t(
                    'Tick Agree on each row that stands up, or suggest a different score with a written justification.'
                )}
            </li>
            <li>
                {i18n.t(
                    'Verify at least {{pct}} of rows before the review can be submitted.',
                    { pct: fmtPercent(MIN_REVIEW_COMPLETION, 0) }
                )}
            </li>
            <li>
                {i18n.t(
                    'Recommend an outcome — approve, request a revision, or reject.'
                )}
            </li>
        </ul>

        <h2 className={styles.h2}>{i18n.t('What each recommendation does')}</h2>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{i18n.t('Recommendation')}</th>
                    <th>{i18n.t('Effect')}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{i18n.t('Approve')}</td>
                    <td>
                        {i18n.t(
                            'The assessment is approved. Any suggested score adjustments are offered to the owner, who accepts or rejects them.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('Request revision')}</td>
                    <td>
                        {i18n.t(
                            'Only the rows the reviewer flagged with a suggested value become editable again. Everything else stays locked.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('Reject')}</td>
                    <td>
                        {i18n.t(
                            'The assessment goes back as rejected and the owner can reopen it as a draft.'
                        )}
                    </td>
                </tr>
            </tbody>
        </table>

        <NoticeBox title={i18n.t('Read-only by design')}>
            {i18n.t(
                'A paired assessment is always shown read-only. A reviewer changes a score by suggesting it, never by typing over the data.'
            )}
        </NoticeBox>
    </section>
)

const Reports = () => (
    <section>
        <p className={styles.lead}>
            {i18n.t(
                'Seven reports over the assessments stored for a year, each of which can be taken away as a PDF, a spreadsheet or a CSV, or printed.'
            )}
        </p>

        <h2 className={styles.h2}>{i18n.t('Available reports')}</h2>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{i18n.t('Report')}</th>
                    <th>{i18n.t('What it shows')}</th>
                </tr>
            </thead>
            <tbody>
                {REPORTS.map((report) => (
                    <tr key={report.id}>
                        <td>{report.name()}</td>
                        <td>{report.description()}</td>
                    </tr>
                ))}
            </tbody>
        </table>

        <h2 className={styles.h2}>{i18n.t('Export options')}</h2>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{i18n.t('Export')}</th>
                    <th>{i18n.t('Contains')}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{i18n.t('PDF')}</td>
                    <td>
                        {i18n.t(
                            'A banner-style landscape document, suitable for printing and circulating. Each section becomes a table, and every page is numbered and dated.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('Excel')}</td>
                    <td>
                        {i18n.t(
                            'An XLSX workbook with one sheet per section. Numeric columns carry real numbers rather than text, so a column can be summed without being retyped.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('CSV')}</td>
                    <td>
                        {i18n.t(
                            'The same rows as one flat file, written with a UTF-8 byte order mark so Excel reads accented names correctly.'
                        )}
                    </td>
                </tr>
                <tr>
                    <td>{i18n.t('Print')}</td>
                    <td>
                        {i18n.t(
                            'Prints the report as shown, with the app chrome hidden. Table headers repeat on each sheet and rows are never split across a page break.'
                        )}
                    </td>
                </tr>
            </tbody>
        </table>

        <NoticeBox title={i18n.t('Read from the datastore, not analytics')}>
            {i18n.t(
                'Every report is built from the assessments already stored for the year, which are the same records the dashboard reads. No report makes an analytics call of its own, so two reports of the same year cannot disagree about a figure.'
            )}
        </NoticeBox>
    </section>
)

const Admin = () => (
    <section>
        <p className={styles.lead}>
            {i18n.t(
                'Administration is where the assessment year is opened, targets are set and indicators are bound to DHIS2 data. It needs the {{auth}} authority.',
                { auth: AUTH_ADMIN }
            )}
        </p>

        <h2 className={styles.h2}>{i18n.t('Tab access by user level')}</h2>
        <p className={styles.body}>
            {i18n.t(
                'Which tabs you see follows how far your remit reaches — ten nationally, five regionally, three at district level. The cut follows what each decision governs, not seniority.'
            )}
        </p>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{i18n.t('User level')}</th>
                    <th>{i18n.t('Tabs available')}</th>
                    <th>{i18n.t('Count')}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{i18n.t('National')}</td>
                    <td>
                        {i18n.t(
                            'Overview, Periods, Targets, Mappings, Regions, Pairings, Users, Settings, Data, Audit'
                        )}
                    </td>
                    <td>10</td>
                </tr>
                <tr>
                    <td>{i18n.t('Regional')}</td>
                    <td>
                        {i18n.t('Overview, Periods, Targets, Pairings, Audit')}
                    </td>
                    <td>5</td>
                </tr>
                <tr>
                    <td>{i18n.t('District')}</td>
                    <td>{i18n.t('Overview, Targets, Pairings')}</td>
                    <td>3</td>
                </tr>
            </tbody>
        </table>

        <h2 className={styles.h2}>{i18n.t('Assessment periods')}</h2>
        <p className={styles.body}>
            {i18n.t(
                'A period decides whether a year accepts submissions. Closing a year stops new submissions but leaves data entry alone, so work in progress is not lost the moment a deadline passes; locking stops editing too. Neither blocks a reviewer from finishing a review already under way.'
            )}
        </p>
        <table className={styles.table}>
            <thead>
                <tr>
                    <th>{i18n.t('Status')}</th>
                    <th>{i18n.t('Editing')}</th>
                    <th>{i18n.t('Submission')}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>{i18n.t('Open')}</td>
                    <td>{i18n.t('Yes')}</td>
                    <td>{i18n.t('Yes')}</td>
                </tr>
                <tr>
                    <td>{i18n.t('Closed')}</td>
                    <td>{i18n.t('Yes')}</td>
                    <td>{i18n.t('No')}</td>
                </tr>
                <tr>
                    <td>{i18n.t('Locked')}</td>
                    <td>{i18n.t('No')}</td>
                    <td>{i18n.t('No')}</td>
                </tr>
                <tr>
                    <td>{i18n.t('Archived')}</td>
                    <td>{i18n.t('No')}</td>
                    <td>{i18n.t('No')}</td>
                </tr>
            </tbody>
        </table>
        <NoticeBox title={i18n.t('A year with no period is open')}>
            {i18n.t(
                'The gate is opted into — creating a period for one year leaves every other year alone. That way adding periods to an instance which already holds assessments does not freeze the past ones.'
            )}
        </NoticeBox>

        <h2 className={styles.h2}>{i18n.t('Target management')}</h2>
        <p className={styles.body}>
            {i18n.t(
                'Targets are what each row is scored against, and they are recorded per year and per tool. Edit them in place, import or export the whole tool as CSV, copy last year as a starting point, or reset a year back to the figures the tool ships with.'
            )}
        </p>
        <NoticeBox title={i18n.t('Only differences are stored')}>
            {i18n.t(
                'A target typed back to the figure the tool ships with stops being an override, so a corrected framework in a later release still reaches that row. Rows whose target is genuinely set locally are marked "varies" and are edited on the assessment itself, not here.'
            )}
        </NoticeBox>

        <h2 className={styles.h2}>{i18n.t('Regions and Users')}</h2>
        <p className={styles.body}>
            {i18n.t(
                'Both are read-only. Org units, roles and authorities belong to DHIS2 and are edited in the Maintenance and Users apps; a second place to change them would be a second place for them to be wrong. What these tabs add is what DHIS2 cannot say from inside itself — how much of the hierarchy has been assessed, and who actually reaches this app and through which role.'
            )}
        </p>

        <h2 className={styles.h2}>{i18n.t('Indicator mapping')}</h2>
        <ol className={styles.bullets}>
            <li>{i18n.t('Choose the tool — regional or district.')}</li>
            <li>
                {i18n.t(
                    'Find the row you want and select Map, then search DHIS2 for the indicator or data element behind it.'
                )}
            </li>
            <li>{i18n.t('Save the mapping.')}</li>
        </ol>
        <p className={styles.body}>
            {i18n.t(
                'Once a row is bound, Fetch DHIS2 data on the assessment page pulls its current and previous year values from analytics. Anything left unbound stays manual entry.'
            )}
        </p>

        <NoticeBox title={i18n.t('Built in and custom')}>
            {i18n.t(
                'Rows marked "Built in" are already bound to the GHS-HA indicators the app ships with, so a fresh install needs no mapping to use them. Rebinding or clearing one marks it "Custom" and overrides what shipped; the app stores only the difference, so a corrected binding in a later release still reaches rows nobody has touched.'
            )}
        </NoticeBox>

        <h2 className={styles.h2}>{i18n.t('Mapping is kept per tool')}</h2>
        <p className={styles.body}>
            {i18n.t(
                'The regional and district tools reuse the same codes for different indicators, so each keeps its own mapping. One saved for a tool can never leak into the other.'
            )}
        </p>
    </section>
)

const Faq = () => (
    <section>
        <dl className={styles.faq}>
            <dt>{i18n.t('Why is my score negative?')}</dt>
            <dd>
                {i18n.t(
                    'Indicators without data score -2. If much of the form is empty the total will be negative. Fill in every indicator you have data for.'
                )}
            </dd>

            <dt>{i18n.t('Why can I not edit the form?')}</dt>
            <dd>
                {i18n.t(
                    'Either you lack the GHS_ASSESSMENT_EDIT authority, or the assessment has been submitted and is locked pending peer review.'
                )}
            </dd>

            <dt>{i18n.t('Why are only some indicators editable?')}</dt>
            <dd>
                {i18n.t(
                    'You are in revision mode. Only the indicators the reviewer flagged can be changed; everything else stays locked.'
                )}
            </dd>

            <dt>
                {i18n.t(
                    'An indicator says Manual but should come from DHIMS2.'
                )}
            </dt>
            <dd>
                {i18n.t(
                    'It has not been mapped yet. An administrator can bind it to a DHIS2 indicator or data element on the Admin page.'
                )}
            </dd>

            <dt>{i18n.t('Can I submit a partially complete assessment?')}</dt>
            <dd>
                {i18n.t(
                    'Only once at least {{pct}} of rows have data. Remember that empty rows still score -2.',
                    { pct: fmtPercent(MIN_SUBMIT_COMPLETION, 0) }
                )}
            </dd>

            <dt>{i18n.t('I submitted a review by mistake.')}</dt>
            <dd>
                {i18n.t(
                    'Use Recall review on the Peer Review page to pull it back and correct it.'
                )}
            </dd>

            <dt>{i18n.t('Where is the data stored?')}</dt>
            <dd>
                {i18n.t(
                    'In the DHIS2 datastore under the ghs-holistic-assessment namespace, one record per year and organisation unit.'
                )}
            </dd>
        </dl>
    </section>
)

const TABS = [
    { label: () => i18n.t('Quick start'), render: () => <QuickStart /> },
    { label: () => i18n.t('Workflow'), render: () => <Workflow /> },
    { label: () => i18n.t('Assessment'), render: () => <Assessment /> },
    { label: () => i18n.t('Scoring'), render: () => <Scoring /> },
    { label: () => i18n.t('Peer review'), render: () => <PeerReview /> },
    { label: () => i18n.t('Reports'), render: () => <Reports /> },
    { label: () => i18n.t('Admin'), render: () => <Admin /> },
    { label: () => i18n.t('FAQ'), render: () => <Faq /> },
]

export const HelpPage = () => {
    const [tab, setTab] = useState(0)

    return (
        <div>
            <header className={styles.header}>
                <h1 className={styles.title}>
                    {i18n.t('Help & Documentation')}
                </h1>
                <p className={styles.subtitle}>
                    {i18n.t(
                        'Learn how to use the GHS Holistic Assessment application'
                    )}
                </p>
            </header>

            <TabBar>
                {TABS.map((t, i) => (
                    <Tab
                        key={t.label()}
                        selected={tab === i}
                        onClick={() => setTab(i)}
                    >
                        {t.label()}
                    </Tab>
                ))}
            </TabBar>

            <div className={styles.panel}>{TABS[tab].render()}</div>
        </div>
    )
}

export default HelpPage
