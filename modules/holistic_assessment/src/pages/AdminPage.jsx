import i18n from '@dhis2/d2-i18n'
import { NoticeBox, Tab, TabBar } from '@dhis2/ui'
import React, { useMemo, useState } from 'react'
import { ORG_LEVEL, scopeOf, useCurrentUser } from '../lib/useCurrentUser.js'
import AuditTab from './admin/AuditTab.jsx'
import DataTab from './admin/DataTab.jsx'
import MappingTab from './admin/MappingTab.jsx'
import OverviewTab from './admin/OverviewTab.jsx'
import PairingsTab from './admin/PairingsTab.jsx'
import PeriodsTab from './admin/PeriodsTab.jsx'
import RegionsTab from './admin/RegionsTab.jsx'
import SettingsTab from './admin/SettingsTab.jsx'
import TargetsTab from './admin/TargetsTab.jsx'
import UsersTab from './admin/UsersTab.jsx'
import styles from './AdminPage.module.css'

/**
 * Which sections a user sees follows how far their remit reaches, as set out in
 * the administration guide: ten tabs nationally, five regionally, three at
 * district level.
 *
 * The cut follows what each decision actually governs. Indicator mapping,
 * settings, backups, the region list and the user list are instance-wide, so
 * they are national. A period decides when the whole country submits, so it is
 * opened nationally, but a region has to see it because it governs whether they
 * can submit at all. Targets reach every level, because they are what an
 * assessment is scored against wherever it is filled in. Pairings are drawn
 * within a region as well as across regions, so districts need them too. The
 * audit trail stops at regional: it spans other people's assessments, which is
 * a regional supervisor's business and not a district's.
 */
const TABS = [
    {
        id: 'overview',
        label: () => i18n.t('Overview'),
        upTo: Infinity,
        render: () => <OverviewTab />,
    },
    {
        id: 'periods',
        label: () => i18n.t('Periods'),
        upTo: ORG_LEVEL.REGIONAL,
        render: () => <PeriodsTab />,
    },
    {
        id: 'targets',
        label: () => i18n.t('Targets'),
        upTo: ORG_LEVEL.DISTRICT,
        render: () => <TargetsTab />,
    },
    {
        id: 'mappings',
        label: () => i18n.t('Mappings'),
        upTo: ORG_LEVEL.NATIONAL,
        render: () => <MappingTab />,
    },
    {
        id: 'regions',
        label: () => i18n.t('Regions'),
        upTo: ORG_LEVEL.NATIONAL,
        render: () => <RegionsTab />,
    },
    {
        id: 'pairings',
        label: () => i18n.t('Pairings'),
        upTo: ORG_LEVEL.DISTRICT,
        render: () => <PairingsTab />,
    },
    {
        id: 'users',
        label: () => i18n.t('Users'),
        upTo: ORG_LEVEL.NATIONAL,
        render: () => <UsersTab />,
    },
    {
        id: 'settings',
        label: () => i18n.t('Settings'),
        upTo: ORG_LEVEL.NATIONAL,
        render: () => <SettingsTab />,
    },
    {
        id: 'data',
        label: () => i18n.t('Data'),
        upTo: ORG_LEVEL.NATIONAL,
        render: () => <DataTab />,
    },
    {
        id: 'audit',
        label: () => i18n.t('Audit'),
        upTo: ORG_LEVEL.REGIONAL,
        render: () => <AuditTab />,
    },
]

export const AdminPage = () => {
    const user = useCurrentUser()
    const [active, setActive] = useState('overview')

    const scope = useMemo(() => scopeOf(user), [user])
    const visible = useMemo(() => TABS.filter((t) => scope <= t.upTo), [scope])

    // A user whose scope narrows while the page is open should not be left on a
    // tab they can no longer see.
    const current =
        visible.find((t) => t.id === active) || visible[0] || TABS[0]

    if (!user.loading && !user.canAdmin) {
        return (
            <NoticeBox warning title={i18n.t('Administrator access required')}>
                {i18n.t(
                    'You need the GHS_ASSESSMENT_ADMIN authority to configure the assessment.'
                )}
            </NoticeBox>
        )
    }

    return (
        <div>
            <header className={styles.header}>
                <h1 className={styles.title}>{i18n.t('Administration')}</h1>
                <span className={styles.count}>
                    {scope === ORG_LEVEL.NATIONAL
                        ? i18n.t('National scope')
                        : scope === ORG_LEVEL.REGIONAL
                          ? i18n.t('Regional scope')
                          : i18n.t('District scope')}
                </span>
            </header>

            <TabBar>
                {visible.map((tab) => (
                    <Tab
                        key={tab.id}
                        selected={tab.id === current.id}
                        onClick={() => setActive(tab.id)}
                    >
                        {tab.label()}
                    </Tab>
                ))}
            </TabBar>

            <div className={styles.tabBody}>{current.render()}</div>
        </div>
    )
}

export default AdminPage
