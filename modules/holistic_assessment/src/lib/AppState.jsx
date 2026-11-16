import PropTypes from 'prop-types'
import React, { createContext, useContext, useMemo, useState } from 'react'

const AppStateContext = createContext(null)

/**
 * Selection shared across pages, so moving from the assessment to the peer
 * review or a report keeps the same year and org unit in view.
 *
 * Assessments normally cover the previous calendar year, which is what the
 * year selector defaults to.
 */
export const AppStateProvider = ({ children }) => {
    const [year, setYear] = useState(new Date().getFullYear() - 1)
    const [regionId, setRegionId] = useState('')
    const [districtId, setDistrictId] = useState('')

    const value = useMemo(
        () => ({
            year,
            setYear,
            regionId,
            setRegionId: (id) => {
                setRegionId(id)
                setDistrictId('')
            },
            districtId,
            setDistrictId,
        }),
        [year, regionId, districtId]
    )

    return (
        <AppStateContext.Provider value={value}>
            {children}
        </AppStateContext.Provider>
    )
}

AppStateProvider.propTypes = {
    children: PropTypes.node,
}

export const useAppState = () => {
    const ctx = useContext(AppStateContext)
    if (!ctx) {
        throw new Error('useAppState must be used inside AppStateProvider')
    }
    return ctx
}
