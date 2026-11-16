import i18n from '@dhis2/d2-i18n'
import {
    AlertBar,
    Button,
    CircularLoader,
    InputField,
    NoticeBox,
    SingleSelectField,
    SingleSelectOption,
} from '@dhis2/ui'
import React, { useState } from 'react'
import { useSettings } from '../../lib/datastore.js'
import { assessmentYears } from '../../lib/format.js'
import styles from '../AdminPage.module.css'

/**
 * The handful of instance-wide settings, stored under `settings`.
 *
 * The default year is what the app opens on; it is a default rather than a
 * lock, so anyone can still switch year from the context bar.
 */
export const SettingsTab = () => {
    const { value: settings, save, loading } = useSettings()
    const [draft, setDraft] = useState(null)
    const [alert, setAlert] = useState(null)

    const current = draft ?? settings
    const dirty = draft !== null

    const set = (patch) => setDraft({ ...current, ...patch })

    const handleSave = async () => {
        try {
            await save(current)
            setDraft(null)
            setAlert({
                message: i18n.t('Settings saved'),
                tone: 'success',
                id: Date.now(),
            })
        } catch (e) {
            setAlert({ message: e.message, tone: 'critical', id: Date.now() })
        }
    }

    if (loading) {
        return (
            <div className={styles.loading}>
                <CircularLoader />
            </div>
        )
    }

    return (
        <section>
            {alert && (
                <AlertBar
                    key={alert.id}
                    duration={5000}
                    success={alert.tone === 'success'}
                    critical={alert.tone === 'critical'}
                    onHidden={() => setAlert(null)}
                >
                    {alert.message}
                </AlertBar>
            )}

            <h2 className={styles.sectionTitle}>{i18n.t('Settings')}</h2>

            <div className={styles.formRow}>
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Default assessment year')}
                        selected={String(current?.defaultYear ?? '')}
                        onChange={({ selected }) =>
                            set({ defaultYear: Number(selected) })
                        }
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
                <div className={styles.grow}>
                    <InputField
                        dense
                        label={i18n.t('Organisation name')}
                        value={current?.organisationName || ''}
                        onChange={({ value }) =>
                            set({ organisationName: value })
                        }
                    />
                </div>
            </div>

            <div className={styles.tabHeader}>
                <Button small primary disabled={!dirty} onClick={handleSave}>
                    {i18n.t('Save settings')}
                </Button>
                {dirty && (
                    <Button small secondary onClick={() => setDraft(null)}>
                        {i18n.t('Discard changes')}
                    </Button>
                )}
            </div>

            <NoticeBox title={i18n.t('The framework is not a setting')}>
                {i18n.t(
                    'Which tool an assessment uses is decided by the level being assessed - regional or district - not by a setting, because the two are different instruments and a record must keep the one it was scored against.'
                )}
            </NoticeBox>
        </section>
    )
}

export default SettingsTab
