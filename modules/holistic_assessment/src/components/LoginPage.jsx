import i18n from '@dhis2/d2-i18n'
import { Button, NoticeBox } from '@dhis2/ui'
import PropTypes from 'prop-types'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import '../theme.css'
import { connect } from '../lib/api.js'
import BrandMark from './BrandMark.jsx'
import styles from './LoginPage.module.css'

const FEATURES = [
    {
        objective: '1',
        title: () => i18n.t('Score every objective'),
        body: () =>
            i18n.t('Indicators and milestones, scored exactly as the published workbook does.'),
    },
    {
        objective: '2',
        title: () => i18n.t('Review between peers'),
        body: () =>
            i18n.t('Regions and districts verify each other’s assessments before approval.'),
    },
    {
        objective: '3',
        title: () => i18n.t('Report with confidence'),
        body: () =>
            i18n.t('National, regional and district reports as PDF, Excel or CSV.'),
    },
]

/**
 * Sign in with the DHIS2 Analysis connection. There is no URL or token to type:
 * DHIS2 Analysis already holds the viewer's DHIS2 connection on its server and
 * signs in to this module with it (POST /holistic/auth/connect). This runs on
 * its own when the page opens; the button retries after the viewer connects.
 */
export const LoginPage = ({ onSignedIn, notice, autoConnect = true }) => {
    const [busy, setBusy] = useState(autoConnect)
    const [error, setError] = useState(null)
    const [needsConnection, setNeedsConnection] = useState(false)
    // The parent passes a new callback each render; the attempt should not
    // re-run because of that, only on mount and when the button is pressed.
    const signedIn = useRef(onSignedIn)
    useEffect(() => {
        signedIn.current = onSignedIn
    }, [onSignedIn])

    const attempt = useCallback(async () => {
        setBusy(true)
        setError(null)
        setNeedsConnection(false)
        try {
            signedIn.current(await connect())
        } catch (err) {
            setNeedsConnection(err.status === 401 && err.body?.reason === 'no-connection')
            setError(err.message)
            setBusy(false)
        }
    }, [])

    // Only on first open: after signing out or an expired session the viewer
    // chooses Continue, rather than being signed straight back in.
    const auto = useRef(autoConnect)
    useEffect(() => {
        if (auto.current) {
            attempt()
        }
    }, [attempt])

    return (
        <main className={styles.page}>
            <section className={styles.showcase} aria-labelledby="showcase-title">
                <div className={styles.showcaseInner}>
                    <div className={styles.showcaseBrand}>
                        <BrandMark onDark size={48} />
                        <span>{i18n.t('Ghana Health Service')}</span>
                    </div>
                    <h1 id="showcase-title" className={styles.showcaseTitle}>
                        {i18n.t('Holistic Assessment')}
                    </h1>
                    <p className={styles.showcaseLead}>
                        {i18n.t(
                            'The annual assessment of regional and district health sector performance, in one place.'
                        )}
                    </p>
                    <ul className={styles.features}>
                        {FEATURES.map((f) => (
                            <li key={f.objective} className={styles.feature}>
                                <span
                                    className={styles.featureDot}
                                    data-dot={f.objective}
                                    aria-hidden="true"
                                />
                                <span>
                                    <strong>{f.title()}</strong>
                                    <span className={styles.featureBody}>
                                        {f.body()}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            <section className={styles.formSide}>
                <div className={styles.card}>
                    <div className={styles.mobileBrand}>
                        <BrandMark size={40} />
                        <div>
                            <p className={styles.mobileTitle}>
                                {i18n.t('Holistic Assessment')}
                            </p>
                            <p className={styles.mobileSubtitle}>
                                {i18n.t('Ghana Health Service')}
                            </p>
                        </div>
                    </div>

                    <h2 className={styles.formTitle}>{i18n.t('Welcome back')}</h2>
                    <p className={styles.lead}>
                        {i18n.t(
                            'Holistic Assessment signs you in with the DHIS2 connection you use for DHIS2 Analysis. Your DHIS2 account decides what you can see and do.'
                        )}
                    </p>

                    {notice && !error && (
                        <NoticeBox className={styles.notice}>{notice}</NoticeBox>
                    )}
                    {error && (
                        <NoticeBox
                            error={!needsConnection}
                            warning={needsConnection}
                            title={
                                needsConnection
                                    ? i18n.t('DHIS2 is not connected')
                                    : i18n.t('Could not sign in')
                            }
                            className={styles.notice}
                        >
                            {error}
                        </NoticeBox>
                    )}

                    <Button
                        primary
                        large
                        onClick={attempt}
                        loading={busy}
                        disabled={busy}
                        className={styles.submit}
                    >
                        {busy ? i18n.t('Connecting…') : i18n.t('Continue')}
                    </Button>

                    {needsConnection && (
                        <p className={styles.lead}>
                            <a href="/connect" target="_top">
                                {i18n.t('Open the DHIS2 Analysis connection page')}
                            </a>
                            {' '}
                            {i18n.t('to connect, then come back and choose Continue.')}
                        </p>
                    )}
                </div>
            </section>
        </main>
    )
}

LoginPage.propTypes = {
    onSignedIn: PropTypes.func.isRequired,
    autoConnect: PropTypes.bool,
    notice: PropTypes.string,
}

export default LoginPage
