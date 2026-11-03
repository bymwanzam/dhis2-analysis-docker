import { useDataQuery } from '@dhis2/app-runtime'
import { useMemo } from 'react'
import { LEVEL, ORG_UNIT_LEVEL } from './constants.js'

const ORG_UNIT_QUERY = {
    orgUnits: {
        resource: 'organisationUnits',
        params: ({ level }) => ({
            fields: 'id,displayName,level,path,parent[id,displayName]',
            filter: `level:eq:${level}`,
            paging: false,
            order: 'displayName:asc',
        }),
    },
}

/**
 * Org units at the level the assessment is being run for: regions are level 2
 * and districts level 3 in the DHIMS2 hierarchy.
 */
export const useOrgUnitsForLevel = (level) => {
    const dhisLevel = ORG_UNIT_LEVEL[level] ?? ORG_UNIT_LEVEL[LEVEL.REGION]
    const { data, loading, error } = useDataQuery(ORG_UNIT_QUERY, {
        variables: { level: dhisLevel },
    })

    const orgUnits = useMemo(
        () => data?.orgUnits?.organisationUnits || [],
        [data]
    )

    return { orgUnits, loading, error }
}

/** Districts belonging to one region, for the district assessment picker. */
export const useDistrictsForRegion = (regionId) => {
    const { orgUnits, loading, error } = useOrgUnitsForLevel(LEVEL.DISTRICT)
    const districts = useMemo(
        () =>
            regionId ? orgUnits.filter((o) => o.parent?.id === regionId) : [],
        [orgUnits, regionId]
    )
    return { districts, loading, error }
}
