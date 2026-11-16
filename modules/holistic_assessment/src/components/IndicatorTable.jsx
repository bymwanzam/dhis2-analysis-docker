import i18n from '@dhis2/d2-i18n'
import cx from 'classnames'
import PropTypes from 'prop-types'
import React, { memo, useCallback } from 'react'
import { targetLabel } from '../framework/index.js'
import { fmtSignedPercent } from '../lib/format.js'
import styles from './IndicatorTable.module.css'
import OutcomeChip from './OutcomeChip.jsx'

const SCORE_OPTIONS = [2, 1, 0, -1, -2]

/**
 * One indicator row. Memoised because an objective can hold 41 rows and the
 * whole table re-renders on every keystroke otherwise.
 */
const IndicatorRow = memo(function IndicatorRow({
    row,
    indicator,
    mapped,
    editable,
    flagged,
    mode,
    reviewEntry,
    onValueChange,
    onReviewChange,
}) {
    const entryDisabled = !editable
    const isReview = mode === 'review'

    const handle = (field) => (e) =>
        onValueChange(indicator.code, field, e.target.value)
    const review = (patch) => onReviewChange?.(indicator.code, patch)

    return (
        <tr
            className={cx({
                [styles.rowLocked]: entryDisabled && mode === 'entry',
                [styles.rowFlagged]: flagged,
            })}
        >
            <td className={styles.code}>{indicator.code}</td>
            <td className={styles.name}>
                {indicator.name}
                {indicator.definition && (
                    <span className={styles.definition}>
                        {indicator.definition}
                    </span>
                )}
            </td>
            <td>
                <span
                    className={cx(styles.badge, {
                        [styles.badgeDhis2]: mapped,
                        [styles.badgeManual]: !mapped,
                    })}
                >
                    {mapped ? i18n.t('DHIS2') : i18n.t('Manual')}
                </span>
            </td>
            <td className={styles.numeric}>
                <input
                    className={styles.input}
                    type="number"
                    step="any"
                    inputMode="decimal"
                    aria-label={i18n.t('{{code}} previous year value', {
                        code: indicator.code,
                    })}
                    value={row.previous ?? ''}
                    disabled={entryDisabled}
                    onChange={handle('previous')}
                />
            </td>
            <td className={styles.numeric}>
                <input
                    className={cx(styles.input, {
                        [styles.inputFromDhis2]: row.source === 'dhis2',
                    })}
                    type="number"
                    step="any"
                    inputMode="decimal"
                    aria-label={i18n.t('{{code}} current year value', {
                        code: indicator.code,
                    })}
                    value={row.current ?? ''}
                    disabled={entryDisabled}
                    onChange={handle('current')}
                />
            </td>
            <td className={styles.numeric}>
                {indicator.targetVaries ? (
                    // Population-scaled targets are set locally, so this one is
                    // the assessed unit's own figure rather than a fixed value.
                    <input
                        className={cx(styles.input, {
                            [styles.inputOverridden]: row.targetOverridden,
                        })}
                        type="number"
                        step="any"
                        inputMode="decimal"
                        aria-label={i18n.t('{{code}} local target', {
                            code: indicator.code,
                        })}
                        value={row.target ?? ''}
                        disabled={entryDisabled}
                        onChange={handle('target')}
                    />
                ) : (
                    targetLabel(indicator)
                )}
                <div className={styles.direction}>
                    {indicator.direction === 'negative'
                        ? i18n.t('lower is better')
                        : i18n.t('higher is better')}
                </div>
            </td>
            <td className={styles.numeric}>{fmtSignedPercent(row.change)}</td>
            <td className={styles.numeric}>{fmtSignedPercent(row.gap)}</td>
            <td className={styles.numeric}>
                <OutcomeChip
                    outcome={row.outcome}
                    overridden={row.overridden}
                    title={indicator.name}
                />
            </td>

            {isReview && (
                <td className={styles.reviewCell}>
                    <div className={styles.reviewControls}>
                        <label className={styles.reviewRow}>
                            <input
                                type="checkbox"
                                checked={Boolean(reviewEntry?.agree)}
                                onChange={(e) =>
                                    review({
                                        agree: e.target.checked,
                                        verified: true,
                                    })
                                }
                            />
                            {i18n.t('Agree')}
                        </label>

                        {!reviewEntry?.agree && (
                            <>
                                <div className={styles.reviewRow}>
                                    <select
                                        className={styles.smallSelect}
                                        aria-label={i18n.t('Suggested score')}
                                        value={
                                            reviewEntry?.suggestedScore ?? ''
                                        }
                                        onChange={(e) =>
                                            review({
                                                suggestedScore:
                                                    e.target.value === ''
                                                        ? undefined
                                                        : Number(
                                                              e.target.value
                                                          ),
                                                verified: true,
                                            })
                                        }
                                    >
                                        <option value="">
                                            {i18n.t('Suggest score…')}
                                        </option>
                                        {SCORE_OPTIONS.map((s) => (
                                            <option key={s} value={s}>
                                                {s > 0 ? `+${s}` : s}
                                            </option>
                                        ))}
                                    </select>

                                    {!mapped && (
                                        <input
                                            className={styles.input}
                                            type="number"
                                            step="any"
                                            placeholder={i18n.t('Value')}
                                            aria-label={i18n.t(
                                                'Suggested corrected value'
                                            )}
                                            value={
                                                reviewEntry?.suggestedValue ??
                                                ''
                                            }
                                            onChange={(e) =>
                                                review({
                                                    suggestedValue:
                                                        e.target.value,
                                                    verified: true,
                                                })
                                            }
                                        />
                                    )}
                                </div>

                                <textarea
                                    className={styles.textarea}
                                    placeholder={i18n.t(
                                        'Justification (required for an adjustment)'
                                    )}
                                    aria-label={i18n.t('Justification')}
                                    value={reviewEntry?.justification ?? ''}
                                    onChange={(e) =>
                                        review({
                                            justification: e.target.value,
                                            verified: true,
                                        })
                                    }
                                />
                            </>
                        )}
                    </div>
                </td>
            )}

            {mode === 'entry' && reviewEntry && !reviewEntry.agree && (
                <td className={styles.reviewCell}>
                    {reviewEntry.suggestedScore !== undefined && (
                        <div className={styles.suggestion}>
                            {i18n.t('Reviewer suggests score {{score}}', {
                                score:
                                    reviewEntry.suggestedScore > 0
                                        ? `+${reviewEntry.suggestedScore}`
                                        : reviewEntry.suggestedScore,
                            })}
                        </div>
                    )}
                    {reviewEntry.suggestedValue && (
                        <div className={styles.suggestion}>
                            {i18n.t('Suggested value {{value}}', {
                                value: reviewEntry.suggestedValue,
                            })}
                        </div>
                    )}
                    {reviewEntry.justification && (
                        <div className={styles.definition}>
                            {reviewEntry.justification}
                        </div>
                    )}
                </td>
            )}
        </tr>
    )
})

IndicatorRow.propTypes = {
    editable: PropTypes.bool,
    flagged: PropTypes.bool,
    indicator: PropTypes.object.isRequired,
    mapped: PropTypes.bool,
    mode: PropTypes.string,
    onReviewChange: PropTypes.func,
    onValueChange: PropTypes.func.isRequired,
    reviewEntry: PropTypes.object,
    row: PropTypes.object.isRequired,
}

/** Scored indicator rows for one objective. */
export const IndicatorTable = ({
    objective,
    mapping = {},
    mode = 'entry',
    canEditCode,
    reviewIndicators = {},
    onValueChange,
    onReviewChange,
}) => {
    const isReview = mode === 'review'
    const showReviewFeedback =
        mode === 'entry' && Object.keys(reviewIndicators).length > 0

    const editableFor = useCallback(
        (code) => (canEditCode ? canEditCode(code) : mode === 'entry'),
        [canEditCode, mode]
    )

    if (!objective) {
        return null
    }

    return (
        // `data-objective` is what colours this table: every accent rule in the
        // stylesheet reads its hue from here, so objective 2 is violet
        // throughout without a single objective-specific class name.
        <div className={styles.wrapper} data-objective={objective.index}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{i18n.t('#')}</th>
                        <th>{i18n.t('Indicator')}</th>
                        <th>{i18n.t('Source')}</th>
                        <th className={styles.numeric}>{i18n.t('Previous')}</th>
                        <th className={styles.numeric}>{i18n.t('Current')}</th>
                        <th className={styles.numeric}>{i18n.t('Target')}</th>
                        <th className={styles.numeric}>{i18n.t('Change')}</th>
                        <th className={styles.numeric}>{i18n.t('Gap')}</th>
                        <th className={styles.numeric}>{i18n.t('Score')}</th>
                        {(isReview || showReviewFeedback) && (
                            <th>
                                {isReview
                                    ? i18n.t('Review')
                                    : i18n.t('Reviewer feedback')}
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {objective.indicatorRows.map((row) => (
                        <IndicatorRow
                            key={row.code}
                            row={row}
                            indicator={row.indicator}
                            mapped={Boolean(mapping[row.code]?.id)}
                            editable={editableFor(row.code)}
                            flagged={Boolean(
                                reviewIndicators[row.code]?.suggestedValue
                            )}
                            mode={mode}
                            reviewEntry={reviewIndicators[row.code]}
                            onValueChange={onValueChange}
                            onReviewChange={onReviewChange}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    )
}

IndicatorTable.propTypes = {
    canEditCode: PropTypes.func,
    mapping: PropTypes.object,
    mode: PropTypes.oneOf(['entry', 'review', 'view']),
    objective: PropTypes.object,
    onReviewChange: PropTypes.func,
    onValueChange: PropTypes.func.isRequired,
    reviewIndicators: PropTypes.object,
}

export default IndicatorTable
