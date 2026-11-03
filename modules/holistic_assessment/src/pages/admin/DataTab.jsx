import i18n from '@dhis2/d2-i18n'
import { AlertBar, Button, NoticeBox } from '@dhis2/ui'
import React, { useState } from 'react'
import { NAMESPACE } from '../../lib/constants.js'
import { useDataStore } from '../../lib/datastore.js'
import styles from '../AdminPage.module.css'

/** Hand the browser a generated file. */
const download = (filename, text, type) => {
    const blob = new Blob([text], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

/**
 * A whole-namespace backup: every key under `ghs-holistic-assessment` read out
 * into one JSON file. That is every assessment, the indicator mapping, the
 * settings and the pairings - enough to reconstruct the app's state.
 *
 * Restoring is deliberately not offered here. Writing a backup back over a live
 * namespace is a destructive operation that wants a considered, out-of-band
 * decision rather than a button next to the one that made the file.
 */
export const DataTab = () => {
    const store = useDataStore()
    const [busy, setBusy] = useState(false)
    const [alert, setAlert] = useState(null)

    const notify = (message, tone = 'success') =>
        setAlert({ message, tone, id: Date.now() })

    const backup = async () => {
        setBusy(true)
        try {
            const keys = await store.listKeys()
            const entries = await Promise.all(
                keys.map(async (key) => [key, await store.read(key)])
            )
            const payload = {
                namespace: NAMESPACE,
                exportedAt: new Date().toISOString(),
                keys: keys.length,
                data: Object.fromEntries(entries),
            }
            download(
                `${NAMESPACE}-backup-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(payload, null, 2),
                'application/json'
            )
            notify(i18n.t('Backed up {{count}} keys', { count: keys.length }))
        } catch (e) {
            notify(e.message, 'critical')
        } finally {
            setBusy(false)
        }
    }

    return (
        <section>
            {alert && (
                <AlertBar
                    key={alert.id}
                    duration={6000}
                    success={alert.tone === 'success'}
                    critical={alert.tone === 'critical'}
                    onHidden={() => setAlert(null)}
                >
                    {alert.message}
                </AlertBar>
            )}

            <h2 className={styles.sectionTitle}>{i18n.t('Backup')}</h2>
            <p className={styles.sectionBody}>
                {i18n.t(
                    'Downloads every key in the {{namespace}} datastore namespace as one JSON file — all assessments, the indicator mapping, the settings and the peer pairings.',
                    { namespace: NAMESPACE }
                )}
            </p>
            <div className={styles.tabHeader}>
                <Button small primary loading={busy} onClick={backup}>
                    {i18n.t('Download backup')}
                </Button>
            </div>

            <NoticeBox title={i18n.t('Restoring is done deliberately')}>
                {i18n.t(
                    'There is no restore button here on purpose — writing a backup back over a live namespace would overwrite work in progress. Restore through the DHIS2 datastore API, key by key, once you are sure what you are replacing.'
                )}
            </NoticeBox>

            <h2 className={styles.sectionTitle}>
                {i18n.t('Assessment exports')}
            </h2>
            <p className={styles.sectionBody}>
                {i18n.t(
                    'Per-year CSV exports of the league table and the full indicator detail live on the Reports page, where a year and level can be chosen first.'
                )}
            </p>
        </section>
    )
}

export default DataTab
