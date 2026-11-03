import i18n from '@dhis2/d2-i18n'
import { Card, Radio, TextAreaField } from '@dhis2/ui'
import PropTypes from 'prop-types'
import React from 'react'
import { MILESTONE_STATUS, MILESTONE_STATUS_LABEL } from '../lib/constants.js'
import { fmtScore } from '../lib/format.js'
import styles from './MilestonePanel.module.css'
import OutcomeChip from './OutcomeChip.jsx'

/**
 * The single milestone attached to each objective. It carries a quarter of the
 * objective's weight, so it moves the score more than any one indicator.
 */
export const MilestonePanel = ({
    milestone,
    row,
    entry = {},
    editable,
    reviewEntry,
    mode = 'entry',
    onChange,
    onReviewChange,
}) => {
    if (!milestone) {
        return null
    }

    const update = (patch) => onChange?.(milestone.code, patch)

    return (
        <Card className={styles.card}>
            <div className={styles.header}>
                <div>
                    <div className={styles.label}>
                        {i18n.t('Objective milestone')}
                    </div>
                    <div className={styles.name}>{milestone.name}</div>
                </div>
                <div className={styles.scoreBox}>
                    <OutcomeChip outcome={row?.outcome} />
                    <div className={styles.weight}>
                        {i18n.t('weight {{w}}', {
                            w: fmtScore(row?.weight, 3),
                        })}
                    </div>
                </div>
            </div>

            <div className={styles.options}>
                {Object.values(MILESTONE_STATUS).map((status) => (
                    <Radio
                        key={status}
                        dense
                        name={`${milestone.code}-status`}
                        label={MILESTONE_STATUS_LABEL[status]}
                        value={status}
                        checked={entry.status === status}
                        disabled={!editable}
                        onChange={() => update({ status })}
                    />
                ))}
            </div>

            <TextAreaField
                dense
                rows={3}
                label={i18n.t('Evidence')}
                placeholder={i18n.t(
                    'Describe the evidence supporting this milestone status'
                )}
                value={entry.evidence || ''}
                disabled={!editable}
                onChange={({ value }) => update({ evidence: value })}
            />

            {mode === 'review' && (
                <div className={styles.review}>
                    <label className={styles.agreeRow}>
                        <input
                            type="checkbox"
                            checked={Boolean(reviewEntry?.agree)}
                            onChange={(e) =>
                                onReviewChange?.(milestone.code, {
                                    agree: e.target.checked,
                                    verified: true,
                                })
                            }
                        />
                        {i18n.t('Evidence supports the claimed status')}
                    </label>
                    <TextAreaField
                        dense
                        rows={2}
                        label={i18n.t('Reviewer comment')}
                        value={reviewEntry?.justification || ''}
                        onChange={({ value }) =>
                            onReviewChange?.(milestone.code, {
                                justification: value,
                                verified: true,
                            })
                        }
                    />
                </div>
            )}

            {mode === 'entry' && reviewEntry?.justification && (
                <div className={styles.feedback}>
                    <strong>{i18n.t('Reviewer')}:</strong>{' '}
                    {reviewEntry.justification}
                </div>
            )}
        </Card>
    )
}

MilestonePanel.propTypes = {
    editable: PropTypes.bool,
    entry: PropTypes.object,
    milestone: PropTypes.object,
    mode: PropTypes.string,
    onChange: PropTypes.func,
    onReviewChange: PropTypes.func,
    reviewEntry: PropTypes.object,
    row: PropTypes.object,
}

export default MilestonePanel
