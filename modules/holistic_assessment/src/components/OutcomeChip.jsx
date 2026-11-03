import i18n from '@dhis2/d2-i18n'
import { Tooltip } from '@dhis2/ui'
import cx from 'classnames'
import PropTypes from 'prop-types'
import React from 'react'
import { SCORE_LABEL } from '../lib/constants.js'
import { outcomeTone, signed } from '../lib/format.js'
import styles from './OutcomeChip.module.css'

/**
 * The -2..+2 outcome for one row. A dotted outline marks a score that was
 * overridden, either by an accepted peer-review adjustment or a manual entry.
 */
export const OutcomeChip = ({ outcome, overridden = false, title }) => {
    if (outcome === null || outcome === undefined) {
        return <span className={cx(styles.chip, styles.neutral)}>—</span>
    }

    const label = SCORE_LABEL[String(outcome)] || ''
    const tip = [title, label, overridden ? i18n.t('Score overridden') : null]
        .filter(Boolean)
        .join(' · ')

    const chip = (
        <span
            className={cx(styles.chip, styles[outcomeTone(outcome)], {
                [styles.overridden]: overridden,
            })}
        >
            {signed(outcome)}
        </span>
    )

    return tip ? (
        <Tooltip content={tip}>
            {({ onMouseOver, onMouseOut, ref }) => (
                <span
                    ref={ref}
                    onMouseOver={onMouseOver}
                    onMouseOut={onMouseOut}
                >
                    {chip}
                </span>
            )}
        </Tooltip>
    ) : (
        chip
    )
}

OutcomeChip.propTypes = {
    outcome: PropTypes.number,
    overridden: PropTypes.bool,
    title: PropTypes.string,
}

export default OutcomeChip
