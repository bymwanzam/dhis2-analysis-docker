import { Tag } from '@dhis2/ui'
import PropTypes from 'prop-types'
import React from 'react'
import { STATUS_LABEL, STATUS_TONE } from '../lib/constants.js'

/** Renders an assessment status as a colour-coded tag. */
export const StatusTag = ({ status, bold = true }) => {
    if (!status) {
        return null
    }
    const tone = STATUS_TONE[status] || 'default'
    const props = { bold }
    if (tone !== 'default') {
        props[tone] = true
    }
    return <Tag {...props}>{STATUS_LABEL[status] || status}</Tag>
}

StatusTag.propTypes = {
    bold: PropTypes.bool,
    status: PropTypes.string,
}

export default StatusTag
