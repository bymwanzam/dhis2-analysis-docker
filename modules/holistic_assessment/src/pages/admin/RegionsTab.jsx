import i18n from '@dhis2/d2-i18n'
import {
    CircularLoader,
    NoticeBox,
    SingleSelectField,
    SingleSelectOption,
    Tag,
} from '@dhis2/ui'
import React, { useMemo, useState } from 'react'
import { LEVEL } from '../../lib/constants.js'
import { useAssessmentKeys } from '../../lib/datastore.js'
import { assessmentYears } from '../../lib/format.js'
import { useOrgUnitsForLevel } from '../../lib/useOrgUnits.js'
import styles from '../AdminPage.module.css'

/**
 * The org unit hierarchy this app runs on, as DHIS2 reports it.
 *
 * The app never stores its own list of regions or districts: it reads them from
 * the instance every time, so a district created or renamed in DHIS2 is simply
 * there. That is the right design, but it leaves nowhere to check what the app
 * currently believes the country looks like — which is what this tab is for. It
 * shows each region, how many districts DHIS2 puts under it, and how many of
 * those have an assessment stored for the selected year.
 *
 * It is deliberately read-only. Regions and districts are DHIS2 metadata, owned
 * by the Maintenance app; a second place to edit them would be a second place
 * for them to be wrong.
 */
export const RegionsTab = () => {
    const [year, setYear] = useState(() => new Date().getFullYear() - 1)

    const { orgUnits: regions, loading: regionsLoading } = useOrgUnitsForLevel(
        LEVEL.REGION
    )
    const { orgUnits: districts, loading: districtsLoading } =
        useOrgUnitsForLevel(LEVEL.DISTRICT)
    const { keys, loading: keysLoading } = useAssessmentKeys()

    const assessedIds = useMemo(
        () =>
            new Set(
                keys.filter((k) => k.year === year).map((k) => k.orgUnitId)
            ),
        [keys, year]
    )

    const rows = useMemo(
        () =>
            regions.map((region) => {
                const own = districts.filter((d) => d.parent?.id === region.id)
                return {
                    region,
                    districts: own.length,
                    districtsAssessed: own.filter((d) => assessedIds.has(d.id))
                        .length,
                    assessed: assessedIds.has(region.id),
                }
            }),
        [regions, districts, assessedIds]
    )

    const orphaned = useMemo(
        () => districts.filter((d) => !d.parent?.id).length,
        [districts]
    )

    const loading = regionsLoading || districtsLoading || keysLoading

    if (loading) {
        return (
            <div className={styles.loading}>
                <CircularLoader />
            </div>
        )
    }

    return (
        <section>
            <h2 className={styles.sectionTitle}>{i18n.t('Regions')}</h2>

            <div className={styles.formRow}>
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Assessment year')}
                        selected={String(year)}
                        onChange={({ selected }) => setYear(Number(selected))}
                    >
                        {assessmentYears().map((y) => (
                            <SingleSelectOption
                                key={y}
                                label={String(y)}
                                value={String(y)}
                            />
                        ))}
                    </SingleSelectField>
                </div>
            </div>

            <div className={styles.tabHeader}>
                <Tag>
                    {i18n.t('{{count}} regions', { count: regions.length })}
                </Tag>
                <Tag>
                    {i18n.t('{{count}} districts', { count: districts.length })}
                </Tag>
            </div>

            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>{i18n.t('Region')}</th>
                            <th className={styles.numeric}>
                                {i18n.t('Districts')}
                            </th>
                            <th className={styles.numeric}>
                                {i18n.t('Districts assessed')}
                            </th>
                            <th>{i18n.t('Regional assessment')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.region.id}>
                                <th scope="row">{row.region.displayName}</th>
                                <td className={styles.numeric}>
                                    {row.districts}
                                </td>
                                <td className={styles.numeric}>
                                    {row.districtsAssessed}
                                </td>
                                <td>
                                    {row.assessed ? (
                                        <Tag positive>{i18n.t('Stored')}</Tag>
                                    ) : (
                                        <Tag>{i18n.t('None')}</Tag>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {orphaned > 0 && (
                <NoticeBox
                    warning
                    title={i18n.t('{{count}} districts have no parent region', {
                        count: orphaned,
                    })}
                >
                    {i18n.t(
                        'A district DHIS2 reports without a parent cannot be rolled up into a region, so it will be missing from the regional dashboard. Correct the hierarchy in the Maintenance app.'
                    )}
                </NoticeBox>
            )}

            <NoticeBox title={i18n.t('Read from DHIS2, not stored here')}>
                {i18n.t(
                    'Regions and districts are DHIS2 metadata. The app reads them fresh every time rather than keeping its own copy, so changes made in the Maintenance app appear here immediately — and there is no second list to fall out of step.'
                )}
            </NoticeBox>
        </section>
    )
}

export default RegionsTab
