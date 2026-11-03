import i18n from '@dhis2/d2-i18n'
import { SingleSelectField, SingleSelectOption } from '@dhis2/ui'
import PropTypes from 'prop-types'
import React from 'react'
import { LEVEL } from '../lib/constants.js'
import { assessmentYears } from '../lib/format.js'
import {
    useDistrictsForRegion,
    useOrgUnitsForLevel,
} from '../lib/useOrgUnits.js'
import styles from './ContextBar.module.css'

/**
 * Year plus org-unit selection. District assessments need a region first, so
 * the district list is filtered by the chosen region.
 */
export const ContextBar = ({
    level,
    year,
    regionId,
    districtId,
    onYearChange,
    onRegionChange,
    onDistrictChange,
    children,
}) => {
    const { orgUnits: regions, loading: regionsLoading } = useOrgUnitsForLevel(
        LEVEL.REGION
    )
    const { districts, loading: districtsLoading } =
        useDistrictsForRegion(regionId)

    const years = assessmentYears()

    return (
        <div className={styles.bar}>
            <div className={styles.field}>
                <SingleSelectField
                    dense
                    label={i18n.t('Assessment year')}
                    selected={year ? String(year) : ''}
                    onChange={({ selected }) => onYearChange(Number(selected))}
                >
                    {years.map((y) => (
                        <SingleSelectOption
                            key={y}
                            label={String(y)}
                            value={String(y)}
                        />
                    ))}
                </SingleSelectField>
            </div>

            <div className={styles.field}>
                <SingleSelectField
                    dense
                    filterable
                    noMatchText={i18n.t('No regions found')}
                    label={i18n.t('Region')}
                    loading={regionsLoading}
                    selected={regionId || ''}
                    onChange={({ selected }) => onRegionChange(selected)}
                >
                    {regions.map((o) => (
                        <SingleSelectOption
                            key={o.id}
                            label={o.displayName}
                            value={o.id}
                        />
                    ))}
                </SingleSelectField>
            </div>

            {level === LEVEL.DISTRICT && (
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        filterable
                        noMatchText={i18n.t('No districts found')}
                        label={i18n.t('District')}
                        loading={districtsLoading}
                        disabled={!regionId}
                        selected={districtId || ''}
                        onChange={({ selected }) => onDistrictChange(selected)}
                    >
                        {districts.map((o) => (
                            <SingleSelectOption
                                key={o.id}
                                label={o.displayName}
                                value={o.id}
                            />
                        ))}
                    </SingleSelectField>
                </div>
            )}

            <div className={styles.actions}>{children}</div>
        </div>
    )
}

ContextBar.propTypes = {
    children: PropTypes.node,
    districtId: PropTypes.string,
    level: PropTypes.string,
    onDistrictChange: PropTypes.func,
    onRegionChange: PropTypes.func,
    onYearChange: PropTypes.func,
    regionId: PropTypes.string,
    year: PropTypes.number,
}

export default ContextBar
