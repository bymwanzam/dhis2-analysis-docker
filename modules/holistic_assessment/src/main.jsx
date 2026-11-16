import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import './locales/index.js'
import { Provider } from '@dhis2/app-runtime'
import i18n from '@dhis2/d2-i18n'
import { CenteredContent, CircularLoader, CssReset, NoticeBox } from '@dhis2/ui'
import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import LoginPage from './components/LoginPage.jsx'
import {
    BASE_PATH,
    SESSION_EXPIRED_EVENT,
    getSession,
    installSessionWatcher,
    logout,
} from './lib/api.js'
import { SessionProvider } from './lib/session.jsx'
import './main.css'

installSessionWatcher()

/**
 * Sign-in gate. The app's own server holds the DHIS2 session; the browser only
 * ever has this app's session cookie. Once signed in, @dhis2/app-runtime is
 * pointed at the server's read-only DHIS2 proxy under /dhis2.
 */
const Root = () => {
    const [state, setState] = useState({ status: 'loading' })

    const refresh = useCallback(async () => {
        try {
            const session = await getSession()
            setState(session ? { status: 'in', session } : { status: 'out' })
        } catch (e) {
            setState({ status: 'error', error: e })
        }
    }, [])

    useEffect(() => {
        refresh()
    }, [refresh])

    useEffect(() => {
        const onExpired = () =>
            setState((s) =>
                s.status === 'in'
                    ? {
                          status: 'out',
                          manual: true,
                          notice: i18n.t(
                              'Your session has ended. Check the DHIS2 connection, then continue.'
                          ),
                      }
                    : s
            )
        window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
    }, [])

    const signOut = useCallback(async () => {
        await logout()
        setState({ status: 'out', manual: true })
    }, [])

    if (state.status === 'loading') {
        return (
            <CenteredContent>
                <CircularLoader />
            </CenteredContent>
        )
    }
    if (state.status === 'error') {
        return (
            <CenteredContent>
                <NoticeBox error title={i18n.t('The server could not be reached')}>
                    {state.error?.message}
                </NoticeBox>
            </CenteredContent>
        )
    }
    if (state.status === 'out') {
        return (
            <LoginPage
                notice={state.notice}
                autoConnect={!state.manual}
                onSignedIn={(session) => setState({ status: 'in', session })}
            />
        )
    }

    const config = {
        baseUrl: `${window.location.origin}${BASE_PATH}/dhis2`,
        apiVersion: state.session.apiVersion,
    }
    return (
        <Provider config={config}>
            <SessionProvider session={state.session} refresh={refresh} signOut={signOut}>
                <App />
            </SessionProvider>
        </Provider>
    )
}

createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <CssReset />
        <Root />
    </React.StrictMode>
)
