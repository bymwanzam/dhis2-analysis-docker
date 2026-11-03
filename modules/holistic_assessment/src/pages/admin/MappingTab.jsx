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
import React, { useMemo, useState } from 'react'
import {
    DEFAULT_FRAMEWORK_ID,
    DISTRICT_FRAMEWORK_ID,
    allIndicators,
    getFramework,
} from '../../framework/index.js'
import { builtinIdsFor, isBuiltinId } from '../../framework/indicator-ids.js'
import {
    mappingForFramework,
    strippedOfBuiltins,
    useIndicatorMapping,
    withFrameworkMapping,
} from '../../lib/datastore.js'
import { useMetadataSearch } from '../../lib/useDhis2Values.js'
import styles from '../AdminPage.module.css'

/**
 * Binds each assessment row to a DHIS2 indicator or data element so the
 * assessment page can fill it from analytics. Anything left unbound stays
 * manual entry.
 */
export const MappingTab = () => {
    const { value: allMapping, save, loading } = useIndicatorMapping()
    const { search, results, loading: searching } = useMetadataSearch()

    // Each tool is mapped separately: the same code means different indicators
    // in the regional and district frameworks.
    const [frameworkId, setFrameworkId] = useState(DEFAULT_FRAMEWORK_ID)
    const framework = useMemo(() => getFramework(frameworkId), [frameworkId])
    const indicators = useMemo(() => allIndicators(framework), [framework])

    const saved = useMemo(
        () => mappingForFramework(allMapping, frameworkId),
        [allMapping, frameworkId]
    )

    // The bindings this release ships, so the table can tell them apart from
    // the ones an administrator chose here.
    const builtin = useMemo(() => builtinIdsFor(frameworkId), [frameworkId])

    const [draft, setDraft] = useState(null)
    const [filter, setFilter] = useState('')
    const [objectiveFilter, setObjectiveFilter] = useState('ALL')
    const [mappedFilter, setMappedFilter] = useState('ALL')
    const [activeCode, setActiveCode] = useState(null)
    const [term, setTerm] = useState('')
    const [alert, setAlert] = useState(null)

    const current = useMemo(() => draft ?? saved, [draft, saved])
    const dirty = draft !== null

    const notify = (message, tone = 'success') =>
        setAlert({ message, tone, id: Date.now() })

    const visible = useMemo(
        () =>
            indicators.filter((ind) => {
                if (
                    objectiveFilter !== 'ALL' &&
                    String(ind.objective) !== objectiveFilter
                ) {
                    return false
                }
                const isMapped = Boolean(current[ind.code]?.id)
                if (mappedFilter === 'MAPPED' && !isMapped) {
                    return false
                }
                if (mappedFilter === 'UNMAPPED' && isMapped) {
                    return false
                }
                if (!filter.trim()) {
                    return true
                }
                const q = filter.trim().toLowerCase()
                return (
                    ind.name.toLowerCase().includes(q) ||
                    ind.code.toLowerCase().includes(q)
                )
            }),
        [indicators, filter, objectiveFilter, mappedFilter, current]
    )

    const mappedCount = useMemo(
        () => indicators.filter((i) => current[i.code]?.id).length,
        [indicators, current]
    )

    const bind = (code, item) => {
        setDraft({
            ...current,
            [code]: item
                ? { id: item.id, name: item.displayName, type: item.type }
                : undefined,
        })
        setActiveCode(null)
        setTerm('')
    }

    const clear = (code) => {
        setDraft({
            ...current,
            // Clearing a shipped binding has to be recorded as a tombstone;
            // merely dropping the key would let the built-in return on the
            // next read.
            [code]: builtin[code] ? null : undefined,
        })
    }

    const handleSave = async () => {
        try {
            // Only the differences from what the app ships are worth storing.
            const cleaned = strippedOfBuiltins(frameworkId, current)
            await save(withFrameworkMapping(allMapping, frameworkId, cleaned))
            setDraft(null)
            notify(i18n.t('Mapping saved'))
        } catch (e) {
            notify(e.message, 'critical')
        }
    }

    return (
        <div>
            <div className={styles.tabHeader}>
                <span className={styles.count}>
                    {i18n.t('{{mapped}} of {{total}} indicators mapped', {
                        mapped: mappedCount,
                        total: indicators.length,
                    })}
                </span>
                <Button small primary disabled={!dirty} onClick={handleSave}>
                    {i18n.t('Save mapping')}
                </Button>
                {dirty && (
                    <Button small secondary onClick={() => setDraft(null)}>
                        {i18n.t('Discard changes')}
                    </Button>
                )}
            </div>

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

            <NoticeBox title={i18n.t('How mapping works')}>
                {i18n.t(
                    'Bind an indicator to a DHIS2 indicator or data element and the assessment page will fetch its current and previous year values from analytics. Unmapped indicators remain manual entry. Rows marked "Built in" are already bound to the GHS-HA indicators this app ships with; rebinding or clearing one overrides it.'
                )}
            </NoticeBox>

            <div className={styles.controls}>
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Assessment tool')}
                        selected={frameworkId}
                        onChange={({ selected }) => {
                            setFrameworkId(selected)
                            // Unsaved edits belong to the tool they were made
                            // against, so switching tools discards them.
                            setDraft(null)
                            setActiveCode(null)
                        }}
                    >
                        <SingleSelectOption
                            label={i18n.t('Regional (94 indicators)')}
                            value={DEFAULT_FRAMEWORK_ID}
                        />
                        <SingleSelectOption
                            label={i18n.t('District (93 indicators)')}
                            value={DISTRICT_FRAMEWORK_ID}
                        />
                    </SingleSelectField>
                </div>
                <div className={styles.grow}>
                    <InputField
                        dense
                        label={i18n.t('Filter indicators')}
                        placeholder={i18n.t('Search by name or code')}
                        value={filter}
                        onChange={({ value }) => setFilter(value)}
                    />
                </div>
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Objective')}
                        selected={objectiveFilter}
                        onChange={({ selected }) =>
                            setObjectiveFilter(selected)
                        }
                    >
                        <SingleSelectOption
                            label={i18n.t('All objectives')}
                            value="ALL"
                        />
                        {framework.objectives.map((o) => (
                            <SingleSelectOption
                                key={o.index}
                                label={i18n.t('Objective {{n}}', {
                                    n: o.index,
                                })}
                                value={String(o.index)}
                            />
                        ))}
                    </SingleSelectField>
                </div>
                <div className={styles.field}>
                    <SingleSelectField
                        dense
                        label={i18n.t('Mapping status')}
                        selected={mappedFilter}
                        onChange={({ selected }) => setMappedFilter(selected)}
                    >
                        <SingleSelectOption label={i18n.t('All')} value="ALL" />
                        <SingleSelectOption
                            label={i18n.t('Mapped')}
                            value="MAPPED"
                        />
                        <SingleSelectOption
                            label={i18n.t('Unmapped')}
                            value="UNMAPPED"
                        />
                    </SingleSelectField>
                </div>
            </div>

            {loading && (
                <div className={styles.loading}>
                    <CircularLoader />
                </div>
            )}

            {!loading && (
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{i18n.t('#')}</th>
                                <th>{i18n.t('Indicator')}</th>
                                <th>{i18n.t('Mapped to')}</th>
                                <th>{i18n.t('Action')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((ind) => {
                                const bound = current[ind.code]
                                const isActive = activeCode === ind.code
                                // Whether this row still points at the
                                // indicator the app shipped it bound to.
                                const shipped = isBuiltinId(
                                    frameworkId,
                                    ind.code,
                                    bound?.id
                                )
                                return (
                                    <React.Fragment key={ind.code}>
                                        <tr>
                                            <td className={styles.code}>
                                                {ind.code}
                                            </td>
                                            <td className={styles.name}>
                                                {ind.name}
                                                <span className={styles.source}>
                                                    {ind.source}
                                                </span>
                                            </td>
                                            <td>
                                                {bound?.id ? (
                                                    <>
                                                        <span
                                                            className={
                                                                styles.bound
                                                            }
                                                        >
                                                            {bound.name}
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.type
                                                            }
                                                        >
                                                            {bound.type}
                                                        </span>
                                                        <span
                                                            className={
                                                                shipped
                                                                    ? styles.builtin
                                                                    : styles.custom
                                                            }
                                                        >
                                                            {shipped
                                                                ? i18n.t(
                                                                      'Built in'
                                                                  )
                                                                : i18n.t(
                                                                      'Custom'
                                                                  )}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span
                                                        className={
                                                            styles.unmapped
                                                        }
                                                    >
                                                        {i18n.t('Manual entry')}
                                                    </span>
                                                )}
                                            </td>
                                            <td className={styles.actionCell}>
                                                <Button
                                                    small
                                                    secondary
                                                    onClick={() => {
                                                        setActiveCode(
                                                            isActive
                                                                ? null
                                                                : ind.code
                                                        )
                                                        setTerm('')
                                                    }}
                                                >
                                                    {isActive
                                                        ? i18n.t('Cancel')
                                                        : i18n.t('Map')}
                                                </Button>
                                                {bound?.id && (
                                                    <Button
                                                        small
                                                        destructive
                                                        onClick={() =>
                                                            clear(ind.code)
                                                        }
                                                    >
                                                        {i18n.t('Clear')}
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                        {isActive && (
                                            <tr>
                                                <td
                                                    colSpan={4}
                                                    className={styles.searchRow}
                                                >
                                                    <InputField
                                                        dense
                                                        label={i18n.t(
                                                            'Search DHIS2 metadata'
                                                        )}
                                                        placeholder={i18n.t(
                                                            'Type at least 2 characters'
                                                        )}
                                                        value={term}
                                                        onChange={({
                                                            value,
                                                        }) => {
                                                            setTerm(value)
                                                            search(value)
                                                        }}
                                                    />
                                                    {searching && (
                                                        <span
                                                            className={
                                                                styles.searching
                                                            }
                                                        >
                                                            {i18n.t(
                                                                'Searching…'
                                                            )}
                                                        </span>
                                                    )}
                                                    <ul
                                                        className={
                                                            styles.results
                                                        }
                                                    >
                                                        {results.map((r) => (
                                                            <li
                                                                key={`${r.type}-${r.id}`}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    className={
                                                                        styles.resultBtn
                                                                    }
                                                                    onClick={() =>
                                                                        bind(
                                                                            ind.code,
                                                                            r
                                                                        )
                                                                    }
                                                                >
                                                                    {
                                                                        r.displayName
                                                                    }
                                                                    <span
                                                                        className={
                                                                            styles.type
                                                                        }
                                                                    >
                                                                        {r.type}
                                                                    </span>
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

export default MappingTab
