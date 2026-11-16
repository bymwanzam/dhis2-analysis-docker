import i18n from '@dhis2/d2-i18n'
import PropTypes from 'prop-types'
import React from 'react'
import { PERFORMANCE_LABEL } from '../lib/constants.js'
import {
    fmtPercent,
    fmtPerformance,
    fmtScore,
    performanceCategory,
} from '../lib/format.js'
import styles from './SummaryPanel.module.css'

/**
 * Objective scores run from -objectiveWeight to +objectiveWeight, so the bar
 * shows the score rescaled onto that full range rather than 0..max.
 */
const fillPercent = (score, maxScore) => {
    if (!maxScore) {
        return 0
    }
    const pct = ((score + maxScore) / (2 * maxScore)) * 100
    return Math.max(0, Math.min(100, pct))
}

/** Live scoring summary shown alongside the assessment form. */
export const SummaryPanel = ({ result, showCompletion = true }) => {
    if (!result) {
        return null
    }

    const category = performanceCategory(result.performance)

    return (
        <div className={styles.panel}>
            {/* `data-performance` colours the headline; the category is spelled
                out beside the number, so colour never carries it alone. */}
            <div className={styles.headline} data-performance={category}>
                <div className={styles.indexLabel}>
                    {i18n.t('Overall performance')}
                </div>
                <div className={styles.indexRow}>
                    <div className={styles.indexValue}>
                        {fmtPerformance(result.performance)}
                    </div>
                    <span className={styles.bandChip}>
                        {PERFORMANCE_LABEL[category]}
                    </span>
                </div>
                <div className={styles.indexTrack}>
                    <div
                        className={styles.indexFill}
                        style={{
                            inlineSize: `${(result.performance / 5) * 100}%`,
                        }}
                    />
                </div>
                <div className={styles.raw}>
                    {i18n.t('Raw score {{score}} of {{max}}', {
                        score: fmtScore(result.total),
                        max: fmtScore(result.maxTotal),
                    })}
                </div>
                {showCompletion && (
                    <div className={styles.raw}>
                        {i18n.t(
                            '{{answered}} of {{total}} rows complete ({{pct}})',
                            {
                                answered: result.answered,
                                total: result.totalRows,
                                pct: fmtPercent(result.completion, 0),
                            }
                        )}
                    </div>
                )}
            </div>

            <div>
                <div className={styles.sectionTitle}>
                    {i18n.t('Objective scores')}
                </div>
                {result.objectives.map((objective) => {
                    const pct = fillPercent(objective.score, objective.maxScore)
                    return (
                        <div
                            key={objective.index}
                            className={styles.objective}
                            data-objective={objective.index}
                        >
                            <div className={styles.objectiveHead}>
                                <span className={styles.objectiveTitle}>
                                    <span className={styles.dot} />
                                    {i18n.t('Objective {{n}}', {
                                        n: objective.index,
                                    })}
                                </span>
                                <span className={styles.objectiveScore}>
                                    {fmtPerformance(objective.performance)}
                                </span>
                            </div>
                            <div className={styles.bar}>
                                {/* Midpoint tick: the bar spans -max..+max, so
                                    half-way is a score of zero. */}
                                <span className={styles.midpoint} />
                                <div
                                    className={styles.barFill}
                                    style={{ inlineSize: `${pct}%` }}
                                />
                            </div>
                            <div className={styles.meta}>
                                {i18n.t('{{answered}}/{{total}} complete', {
                                    answered: objective.answered,
                                    total: objective.total,
                                })}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

SummaryPanel.propTypes = {
    result: PropTypes.object,
    showCompletion: PropTypes.bool,
}

export default SummaryPanel
