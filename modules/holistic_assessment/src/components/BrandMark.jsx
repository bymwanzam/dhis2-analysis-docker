import PropTypes from 'prop-types'
import React from 'react'

/*
 * The app icon drawn inline: three arcs, one per objective, around a white
 * core. Decorative only — the name beside it says what it is.
 *
 * On a dark surface the objective accents are too deep to read, so `onDark`
 * swaps in light versions of the same three hues.
 */
const ARC = 26 // of a 94.25 circumference, leaving three even gaps
const CIRCUMFERENCE = 94.25

export const BrandMark = ({ className, onDark = false, size = 40 }) => {
    const colours = onDark
        ? ['#7fd39b', '#8ab8f0', '#f6a961']
        : ['var(--ghs-obj1)', 'var(--ghs-obj2)', 'var(--ghs-obj3)']
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 40 40"
            aria-hidden="true"
            focusable="false"
        >
            {colours.map((stroke, i) => (
                <circle
                    key={stroke}
                    cx="20"
                    cy="20"
                    r="15"
                    fill="none"
                    stroke={stroke}
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={`${ARC} ${CIRCUMFERENCE - ARC}`}
                    strokeDashoffset={-(CIRCUMFERENCE / 3) * i}
                    transform="rotate(-90 20 20)"
                />
            ))}
            <circle
                cx="20"
                cy="20"
                r="6.5"
                fill={onDark ? '#ffffff' : 'var(--ghs-brand-deep)'}
            />
        </svg>
    )
}

BrandMark.propTypes = {
    className: PropTypes.string,
    onDark: PropTypes.bool,
    size: PropTypes.number,
}

export default BrandMark
