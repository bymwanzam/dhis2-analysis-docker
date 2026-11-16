import PropTypes from 'prop-types'
import React, { createContext, useContext } from 'react'

/**
 * The signed-in user as the server sees them: their DHIS2 profile with the
 * authorities this app grants, including those that come from DHIS2 user
 * groups rather than roles.
 */
const SessionContext = createContext(null)

export const SessionProvider = ({ session, refresh, signOut, children }) => (
    <SessionContext.Provider value={{ ...session, refresh, signOut }}>
        {children}
    </SessionContext.Provider>
)

SessionProvider.propTypes = {
    children: PropTypes.node,
    refresh: PropTypes.func,
    session: PropTypes.object,
    signOut: PropTypes.func,
}

export const useSession = () => {
    const value = useContext(SessionContext)
    if (!value) {
        throw new Error('useSession must be used inside SessionProvider')
    }
    return value
}
