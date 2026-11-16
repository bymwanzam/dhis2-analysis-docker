import i18n from '@dhis2/d2-i18n'
import {
    CssVariables,
    IconDashboardWindow24,
    IconEditItems24,
    IconLocation24,
    IconLogOut24,
    IconQuestion24,
    IconSettings24,
    IconUpload24,
    IconUserGroup24,
    IconVisualizationColumn24,
} from '@dhis2/ui'
import PropTypes from 'prop-types'
import React from 'react'
import {
    HashRouter,
    NavLink,
    Navigate,
    Route,
    Routes,
    useLocation,
} from 'react-router-dom'
import './theme.css'
import styles from './App.module.css'
import BrandMark from './components/BrandMark.jsx'
import { AppStateProvider } from './lib/AppState.jsx'
import { LEVEL } from './lib/constants.js'
import { useSession } from './lib/session.jsx'
import { useCurrentUser } from './lib/useCurrentUser.js'
import AdminPage from './pages/AdminPage.jsx'
import AssessmentPage from './pages/AssessmentPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import HelpPage from './pages/HelpPage.jsx'
import PeerReviewPage from './pages/PeerReviewPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import UploadPage from './pages/UploadPage.jsx'

/** Grouped so the sidebar reads as four jobs: look, assess, review, support. */
const NAV = [
    {
        heading: () => i18n.t('Overview'),
        items: [
            {
                to: '/dashboard',
                icon: IconDashboardWindow24,
                label: () => i18n.t('Dashboard'),
            },
            {
                to: '/reports',
                icon: IconVisualizationColumn24,
                label: () => i18n.t('Reports'),
            },
        ],
    },
    {
        heading: () => i18n.t('Assess'),
        items: [
            {
                to: '/regional',
                icon: IconEditItems24,
                label: () => i18n.t('Regional Assessment'),
            },
            {
                to: '/district',
                icon: IconLocation24,
                label: () => i18n.t('District Assessment'),
            },
            {
                to: '/upload',
                icon: IconUpload24,
                label: () => i18n.t('Local Upload'),
            },
        ],
    },
    {
        heading: () => i18n.t('Peer review'),
        items: [
            {
                to: '/peer-review/regional',
                icon: IconUserGroup24,
                label: () => i18n.t('Regional Peer Review'),
            },
            {
                to: '/peer-review/district',
                icon: IconUserGroup24,
                label: () => i18n.t('District Peer Review'),
            },
        ],
    },
    {
        heading: () => i18n.t('Support'),
        items: [
            {
                to: '/admin',
                icon: IconSettings24,
                label: () => i18n.t('Administration'),
                adminOnly: true,
            },
            {
                to: '/help',
                icon: IconQuestion24,
                label: () => i18n.t('Help'),
            },
        ],
    },
]

const initialsOf = (name = '') =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('') || '?'

const roleOf = (user) => {
    if (user.isSuperuser) {
        return i18n.t('Superuser')
    }
    if (user.canAdmin) {
        return i18n.t('Administrator')
    }
    if (user.canReview && user.canEdit) {
        return i18n.t('Assessor and reviewer')
    }
    if (user.canReview) {
        return i18n.t('Peer reviewer')
    }
    return user.canEdit ? i18n.t('Assessor') : i18n.t('Viewer')
}

const Sidebar = () => {
    const current = useCurrentUser()
    const { canAdmin, user } = current
    const { signOut } = useSession()
    const name = user?.displayName || user?.username || ''

    return (
        <nav className={styles.sidebar} aria-label={i18n.t('Main navigation')}>
            <div className={styles.sidebarInner}>
                <div className={styles.brand}>
                    <BrandMark className={styles.brandMark} onDark />
                    <span className={styles.brandText}>
                        <span className={styles.brandTitle}>
                            {i18n.t('Holistic Assessment')}
                        </span>
                        <span className={styles.brandSubtitle}>
                            {i18n.t('Ghana Health Service')}
                        </span>
                    </span>
                </div>

                <div className={styles.navGroups}>
                    {NAV.map((group) => {
                        const items = group.items.filter(
                            (item) => !item.adminOnly || canAdmin
                        )
                        if (!items.length) {
                            return null
                        }
                        return (
                            <div
                                className={styles.navGroup}
                                key={group.heading()}
                            >
                                <span className={styles.navHeading}>
                                    {group.heading()}
                                </span>
                                <ul className={styles.navList}>
                                    {items.map(({ to, icon: Icon, label }) => (
                                        <li key={to}>
                                            <NavLink
                                                to={to}
                                                className={({ isActive }) =>
                                                    isActive
                                                        ? `${styles.navLink} ${styles.navLinkActive}`
                                                        : styles.navLink
                                                }
                                            >
                                                <span
                                                    className={styles.navIcon}
                                                    aria-hidden="true"
                                                >
                                                    <Icon color="currentColor" />
                                                </span>
                                                <span
                                                    className={styles.navLabel}
                                                >
                                                    {label()}
                                                </span>
                                            </NavLink>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )
                    })}
                </div>

                <div className={styles.account}>
                    <span className={styles.avatar} aria-hidden="true">
                        {initialsOf(name)}
                    </span>
                    <span className={styles.accountText}>
                        <span className={styles.accountName}>{name}</span>
                        <span className={styles.accountRole}>
                            {roleOf(current)}
                        </span>
                    </span>
                    <button
                        type="button"
                        className={styles.signOut}
                        onClick={signOut}
                        title={i18n.t('Sign out')}
                    >
                        <IconLogOut24 color="currentColor" />
                        <span className={styles.visuallyHidden}>
                            {i18n.t('Sign out')}
                        </span>
                    </button>
                </div>
            </div>
        </nav>
    )
}

/** Each page arrives with a short rise, keyed to the route. */
const PageTransition = ({ children }) => {
    const { pathname } = useLocation()
    return (
        <div key={pathname} className={styles.page}>
            {children}
        </div>
    )
}

PageTransition.propTypes = { children: PropTypes.node }

/*
 * Both values are substituted at build time by the `define` in vite.config.js:
 * the version from package.json, the build stamp from the build date. Neither is
 * set when a test imports this module, so both fall back rather than printing
 * "undefined" next to a figure somebody may be about to quote.
 */
const VERSION = process.env.DHIS2_APP_VERSION || '0.0.0'
const BUILD = process.env.DHIS2_APP_BUILD || 'dev'

const Footer = () => (
    <footer className={styles.footer}>
        <span>
            {i18n.t('© {{year}} Bigvalues IT Systems', {
                year: new Date().getFullYear(),
            })}
        </span>
        <span className={styles.footerBuild}>
            {i18n.t('Version {{version}} (Build {{build}})', {
                version: VERSION,
                build: BUILD,
            })}
        </span>
    </footer>
)

const MyApp = () => (
    <HashRouter>
        <CssVariables colors spacers theme />
        <AppStateProvider>
            <div className={styles.shell}>
                <div className={styles.layout}>
                    <Sidebar />
                    <div className={styles.mainColumn}>
                        <main className={styles.main}>
                            <PageTransition>
                                <Routes>
                                    <Route
                                        path="/"
                                        element={
                                            <Navigate to="/dashboard" replace />
                                        }
                                    />
                                    <Route
                                        path="/dashboard"
                                        element={<DashboardPage />}
                                    />
                                    <Route
                                        path="/regional"
                                        element={
                                            <AssessmentPage
                                                level={LEVEL.REGION}
                                            />
                                        }
                                    />
                                    <Route
                                        path="/district"
                                        element={
                                            <AssessmentPage
                                                level={LEVEL.DISTRICT}
                                            />
                                        }
                                    />
                                    <Route
                                        path="/peer-review"
                                        element={<PeerReviewPage />}
                                    />
                                    <Route
                                        path="/peer-review/regional"
                                        element={
                                            <PeerReviewPage
                                                level={LEVEL.REGION}
                                            />
                                        }
                                    />
                                    <Route
                                        path="/peer-review/district"
                                        element={
                                            <PeerReviewPage
                                                level={LEVEL.DISTRICT}
                                            />
                                        }
                                    />
                                    <Route
                                        path="/upload"
                                        element={<UploadPage />}
                                    />
                                    <Route
                                        path="/reports"
                                        element={<ReportsPage />}
                                    />
                                    <Route
                                        path="/admin"
                                        element={<AdminPage />}
                                    />
                                    <Route
                                        path="/help"
                                        element={<HelpPage />}
                                    />
                                    <Route
                                        path="*"
                                        element={
                                            <Navigate to="/dashboard" replace />
                                        }
                                    />
                                </Routes>
                            </PageTransition>
                        </main>
                        <Footer />
                    </div>
                </div>
            </div>
        </AppStateProvider>
    </HashRouter>
)

export default MyApp
