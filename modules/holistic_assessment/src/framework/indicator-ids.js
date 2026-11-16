/**
 * DHIS2 indicators that ship with the app, keyed by framework and indicator
 * code.
 *
 * The instance publishes one indicator per assessment row, named
 * `GHS-HA-<code> - <indicator>`. Binding them here lets a fresh install pull
 * 53 of the 94 regional rows straight from analytics instead of waiting for an
 * administrator to map each one by hand. Every code absent from this file
 * stays manual entry, which is what the assessment table labels "Manual".
 *
 * Those DHIS2 names carry the **regional** numbering, and the two tools do not
 * share it. The district tool drops regional 1.35 (Mass Drug Administration
 * Coverage for Schistosomiasis), so from there on its codes run one behind:
 * `GHS-HA-1.41`, Completeness of reporting by health facilities, is district
 * 1.40. The district block below is therefore matched on each indicator's
 * *name* rather than its number, and two rows have no district counterpart at
 * all, so they are deliberately missing from it:
 *
 *   - 1.17 is "Doctor to population ratio" regionally but "Physician Assistant
 *     to population ratio" in a district - a different measure.
 *   - 1.35 is the row the district tool drops.
 *
 * These are defaults, not decrees. An administrator can rebind or clear any of
 * them on the Admin page and what they save wins; see `mappingForFramework` in
 * `src/lib/datastore.js` for how the two layers combine.
 */

const INDICATOR = 'INDICATOR'

/** Regional tool - `ghs-ha-2025`. 53 of 94 indicators. */
const REGIONAL_IDS = {
    1.1: {
        id: 'U8DSAPaNJ8U',
        name: 'GHS-HA-1.1 - Average revenue per OPD patient',
    },
    '1.10': {
        id: 'z0Pko0IWsUf',
        name: 'GHS-HA-1.10 - Family Planning Acceptor rate',
    },
    1.11: {
        id: 'ZBYi5YP7smU',
        name: 'GHS-HA-1.11 - Long Term couple year protection',
    },
    1.12: {
        id: 'YaA4H1UKA04',
        name: 'GHS-HA-1.12 - Proportion of deliveries attended by trained health workers',
    },
    1.13: {
        id: 'JMqveqtlz4F',
        name: 'GHS-HA-1.13 - Percentage of PNC registrants seen within the first 48 hours after delivery',
    },
    1.14: {
        id: 'yid9Ty9DG5n',
        name: 'GHS-HA-1.14 - Percentage of ANC registrants making 4th ANC visit',
    },
    1.15: {
        id: 'a8Vk0yPL74E',
        name: 'GHS-HA-1.15 - The proportion(%) of children due for Measles-Rubella 2 receiving LLIN',
    },
    1.16: {
        id: 'ePCiujvIdov',
        name: 'GHS-HA-1.16 - Percentage of babies breastfeeding within 1hr after delivery',
    },
    1.17: {
        id: 'gdQcOkOULr0',
        name: 'GHS-HA-1.17 - Doctor to population ratio',
    },
    1.18: {
        id: 'iMVN6quQxgS',
        name: 'GHS-HA-1.18 - Nurse to population ratio',
    },
    1.19: {
        id: 'TbqMfLHySKN',
        name: 'GHS-HA-1.19 - Midwife to WIFA population ratio',
    },
    1.24: {
        id: 'AlFwKpcAhhh',
        name: 'GHS-HA-1.24 - Percentage of completeness of Financial Returns in DHIMS2',
    },
    1.29: {
        id: 'gDPbfzopmMt',
        name: 'GHS-HA-1.29 - Proportion of functional Community-Based Health Planning and Services (CHPS) zones',
    },
    1.34: {
        id: 'FBLEFQdnxZa',
        name: 'GHS-HA-1.34 - Per capita Out Patient Department (OPD) attendance',
    },
    1.35: {
        id: 'Vqa8SDOXctE',
        name: 'GHS-HA-1.35 - Mass Drug Administration Coverage for Schistosomiasis (theurapitical)',
    },
    1.41: {
        id: 'hBBt7L8Y3JD',
        name: 'GHS-HA-1.41 - Completeness of reporting by health facilities',
    },
    2.2: {
        id: 'Ynlziyx1vxa',
        name: 'GHS-HA-2.2 - Incidence rate of diabetes (using OPD as proxy)',
    },
    2.3: {
        id: 'zPgRgfyTtqx',
        name: 'GHS-HA-2.3 - Incidence rate of Hypertension (using OPD as proxy)',
    },
    2.4: {
        id: 'TqTq8q5QvQh',
        name: 'GHS-HA-2.4 -  Percentage of children (0–59 months) who at registration had their length/height measured to assess stunting',
    },
    2.5: {
        id: 'NbD6DMJ7Cna',
        name: 'GHS-HA-2.5 - Percentage of pregnant women anaemic at 36 weeks',
    },
    2.6: {
        id: 'Y8lRzOpB9PT',
        name: 'GHS-HA-2.6 - Percentage of children under 5 years receiving at least 1 dose of Vitamin A',
    },
    2.7: {
        id: 'lkIjqVddxOL',
        name: 'GHS-HA-2.7 - Percentage of ANC Registrants within the First Trimester',
    },
    2.8: { id: 'abcWXyv0zpa', name: 'GHS-HA-2.8 - Penta 3 coverage under 1' },
    2.9: {
        id: 'nEG6Q2kC1BI',
        name: 'GHS-HA-2.9 - Percentage Underweight 0-59 months',
    },
    '2.10': {
        id: 'dY0YcmpBYF3',
        name: 'GHS-HA-2.10 Institutional all-cause mortality rate',
    },
    2.11: {
        id: 'UNYCuWTTCM1',
        name: 'GHS-HA-2.11 - Institutional Maternal Mortality Ratio per 100,000',
    },
    2.12: {
        id: 'zWpjxx0wIro',
        name: 'GHS-HA-2.12 - Institutional Neonatal Mortality Rate per 1000',
    },
    2.13: { id: 'utKezhxjV2g', name: 'GHS-HA-2.13 - Still birth rate' },
    2.14: {
        id: 'v0oieWLef3P',
        name: 'GHS-HA-2.14 - Under 5 Malaria Case Fatality Rate',
    },
    2.15: {
        id: 'uoQugqhdu91',
        name: 'GHS-HA-2.15 - Measles-Rubella2 (MR-2) coverage (18-59months)',
    },
    2.16: {
        id: 'CBZaV7o8mbU',
        name: 'GHS-HA-2.16 - Percentage maternal audits to maternal deaths',
    },
    3.3: {
        id: 'HfHp3BCDxir',
        name: 'GHS-HA-3.3 - Bed occupancy rate - All Wards',
    },
    3.6: {
        id: 'E5ncAuCtOVj',
        name: 'GHS-HA-3.6 - Average number of medicines prescribed per patient encounter (public facilities )',
    },
    3.7: {
        id: 'h7oNhnU3W63',
        name: 'GHS-HA-3.7 - Percentage of encounters with an injection prescribed',
    },
    3.8: {
        id: 'xh1jcddc99M',
        name: 'GHS-HA-3.8 - Percentage of medicines prescribed by generic name',
    },
    3.9: {
        id: 'M1k5K6Hyt5K',
        name: 'GHS-HA-3.9 - Percentage of encounters with an antibiotic prescribed',
    },
    3.12: {
        id: 'irfpWH4e2K4',
        name: 'GHS-HA-3.12 - Proportion of attempted suicide cases',
    },
    3.13: {
        id: 'fpNNvRm5mRd',
        name: 'GHS-HA-3.13 - Incidence of depression (using OPD as proxy)',
    },
    3.14: {
        id: 'Q1Fq7Tzf412',
        name: 'GHS-HA-3.14 - Cataract surgery (Surgical) rate',
    },
    3.15: { id: 's9Y7SdvSEU8', name: 'GHS-HA-3.15 - ART Coverage' },
    3.16: {
        id: 'esLA3BDAkM7',
        name: 'GHS-HA-3.16 - Viral Load Testing Coverage Rate',
    },
    3.17: {
        id: 'uupZvbWx7ek',
        name: 'GHS-HA-3.17 - PMTCT testing coverage rate',
    },
    3.18: { id: 'cWTANnGDxu4', name: 'GHS-HA-3.18 - TB Case fatality rate' },
    3.19: {
        id: 'EGS3pFgeBGI',
        name: 'GHS-HA-3.19 - TB notification rate per 100,000 population',
    },
    '3.20': { id: 'SPJLukKxHaj', name: 'GHS-HA-3.20 - Treatment success rate' },
    3.21: {
        id: 'jWeieUbIrgp',
        name: 'GHS-HA-3.21 - Proportion of suspected malaria cases that were tested for malaria before treatment',
    },
    3.22: {
        id: 'WCaU8k3jcdN',
        name: 'GHS-HA-3.22 - Institutional malaria deaths per 1000 population per year',
    },
    3.24: {
        id: 'MPmqZNIQrqI',
        name: 'GHS-HA-3.24 - Surgical Site Infection Rate',
    },
    3.25: {
        id: 'wK0bd9tFKII',
        name: 'GHS-HA-3.25 - PLHIV newly enrolled in HIV care started on TB preventive therapy',
    },
    3.26: {
        id: 'fOBmW8kK6cx',
        name: 'GHS-HA-3.26 - Percentage of infants born to HIV-infected mothers who are infected before 18 months',
    },
    3.27: {
        id: 'sJPfP23pR4G',
        name: 'GHS-HA-3.27 - Proportion of pregnant women tested for syphilis',
    },
    3.28: {
        id: 'T2evSkq5Nj6',
        name: 'GHS-HA-3.28 - Confirmed OPD Malaria cases per 1000 population',
    },
    3.29: {
        id: 'fQruPHq63T7',
        name: 'GHS-HA-3.29 - Percentage (%) of pregnant women receiving IPTp3',
    },
}

/** District tool - `ghs-ha-2025-district`. 51 of 93 indicators. */
const DISTRICT_IDS = {
    1.1: {
        id: 'U8DSAPaNJ8U',
        name: 'GHS-HA-1.1 - Average revenue per OPD patient',
    },
    '1.10': {
        id: 'z0Pko0IWsUf',
        name: 'GHS-HA-1.10 - Family Planning Acceptor rate',
    },
    1.11: {
        id: 'ZBYi5YP7smU',
        name: 'GHS-HA-1.11 - Long Term couple year protection',
    },
    1.12: {
        id: 'YaA4H1UKA04',
        name: 'GHS-HA-1.12 - Proportion of deliveries attended by trained health workers',
    },
    1.13: {
        id: 'JMqveqtlz4F',
        name: 'GHS-HA-1.13 - Percentage of PNC registrants seen within the first 48 hours after delivery',
    },
    1.14: {
        id: 'yid9Ty9DG5n',
        name: 'GHS-HA-1.14 - Percentage of ANC registrants making 4th ANC visit',
    },
    1.15: {
        id: 'a8Vk0yPL74E',
        name: 'GHS-HA-1.15 - The proportion(%) of children due for Measles-Rubella 2 receiving LLIN',
    },
    1.16: {
        id: 'ePCiujvIdov',
        name: 'GHS-HA-1.16 - Percentage of babies breastfeeding within 1hr after delivery',
    },
    1.18: {
        id: 'iMVN6quQxgS',
        name: 'GHS-HA-1.18 - Nurse to population ratio',
    },
    1.19: {
        id: 'TbqMfLHySKN',
        name: 'GHS-HA-1.19 - Midwife to WIFA population ratio',
    },
    1.24: {
        id: 'AlFwKpcAhhh',
        name: 'GHS-HA-1.24 - Percentage of completeness of Financial Returns in DHIMS2',
    },
    1.29: {
        id: 'gDPbfzopmMt',
        name: 'GHS-HA-1.29 - Proportion of functional Community-Based Health Planning and Services (CHPS) zones',
    },
    1.34: {
        id: 'FBLEFQdnxZa',
        name: 'GHS-HA-1.34 - Per capita Out Patient Department (OPD) attendance',
    },
    '1.40': {
        id: 'hBBt7L8Y3JD',
        name: 'GHS-HA-1.41 - Completeness of reporting by health facilities',
    },
    2.2: {
        id: 'Ynlziyx1vxa',
        name: 'GHS-HA-2.2 - Incidence rate of diabetes (using OPD as proxy)',
    },
    2.3: {
        id: 'zPgRgfyTtqx',
        name: 'GHS-HA-2.3 - Incidence rate of Hypertension (using OPD as proxy)',
    },
    2.4: {
        id: 'TqTq8q5QvQh',
        name: 'GHS-HA-2.4 -  Percentage of children (0–59 months) who at registration had their length/height measured to assess stunting',
    },
    2.5: {
        id: 'NbD6DMJ7Cna',
        name: 'GHS-HA-2.5 - Percentage of pregnant women anaemic at 36 weeks',
    },
    2.6: {
        id: 'Y8lRzOpB9PT',
        name: 'GHS-HA-2.6 - Percentage of children under 5 years receiving at least 1 dose of Vitamin A',
    },
    2.7: {
        id: 'lkIjqVddxOL',
        name: 'GHS-HA-2.7 - Percentage of ANC Registrants within the First Trimester',
    },
    2.8: { id: 'abcWXyv0zpa', name: 'GHS-HA-2.8 - Penta 3 coverage under 1' },
    2.9: {
        id: 'nEG6Q2kC1BI',
        name: 'GHS-HA-2.9 - Percentage Underweight 0-59 months',
    },
    '2.10': {
        id: 'dY0YcmpBYF3',
        name: 'GHS-HA-2.10 Institutional all-cause mortality rate',
    },
    2.11: {
        id: 'UNYCuWTTCM1',
        name: 'GHS-HA-2.11 - Institutional Maternal Mortality Ratio per 100,000',
    },
    2.12: {
        id: 'zWpjxx0wIro',
        name: 'GHS-HA-2.12 - Institutional Neonatal Mortality Rate per 1000',
    },
    2.13: { id: 'utKezhxjV2g', name: 'GHS-HA-2.13 - Still birth rate' },
    2.14: {
        id: 'v0oieWLef3P',
        name: 'GHS-HA-2.14 - Under 5 Malaria Case Fatality Rate',
    },
    2.15: {
        id: 'uoQugqhdu91',
        name: 'GHS-HA-2.15 - Measles-Rubella2 (MR-2) coverage (18-59months)',
    },
    2.16: {
        id: 'CBZaV7o8mbU',
        name: 'GHS-HA-2.16 - Percentage maternal audits to maternal deaths',
    },
    3.3: {
        id: 'HfHp3BCDxir',
        name: 'GHS-HA-3.3 - Bed occupancy rate - All Wards',
    },
    3.6: {
        id: 'E5ncAuCtOVj',
        name: 'GHS-HA-3.6 - Average number of medicines prescribed per patient encounter (public facilities )',
    },
    3.7: {
        id: 'h7oNhnU3W63',
        name: 'GHS-HA-3.7 - Percentage of encounters with an injection prescribed',
    },
    3.8: {
        id: 'xh1jcddc99M',
        name: 'GHS-HA-3.8 - Percentage of medicines prescribed by generic name',
    },
    3.9: {
        id: 'M1k5K6Hyt5K',
        name: 'GHS-HA-3.9 - Percentage of encounters with an antibiotic prescribed',
    },
    3.12: {
        id: 'irfpWH4e2K4',
        name: 'GHS-HA-3.12 - Proportion of attempted suicide cases',
    },
    3.13: {
        id: 'fpNNvRm5mRd',
        name: 'GHS-HA-3.13 - Incidence of depression (using OPD as proxy)',
    },
    3.14: {
        id: 'Q1Fq7Tzf412',
        name: 'GHS-HA-3.14 - Cataract surgery (Surgical) rate',
    },
    3.15: { id: 's9Y7SdvSEU8', name: 'GHS-HA-3.15 - ART Coverage' },
    3.16: {
        id: 'esLA3BDAkM7',
        name: 'GHS-HA-3.16 - Viral Load Testing Coverage Rate',
    },
    3.17: {
        id: 'uupZvbWx7ek',
        name: 'GHS-HA-3.17 - PMTCT testing coverage rate',
    },
    3.18: { id: 'cWTANnGDxu4', name: 'GHS-HA-3.18 - TB Case fatality rate' },
    3.19: {
        id: 'EGS3pFgeBGI',
        name: 'GHS-HA-3.19 - TB notification rate per 100,000 population',
    },
    '3.20': { id: 'SPJLukKxHaj', name: 'GHS-HA-3.20 - Treatment success rate' },
    3.21: {
        id: 'jWeieUbIrgp',
        name: 'GHS-HA-3.21 - Proportion of suspected malaria cases that were tested for malaria before treatment',
    },
    3.22: {
        id: 'WCaU8k3jcdN',
        name: 'GHS-HA-3.22 - Institutional malaria deaths per 1000 population per year',
    },
    3.24: {
        id: 'MPmqZNIQrqI',
        name: 'GHS-HA-3.24 - Surgical Site Infection Rate',
    },
    3.25: {
        id: 'wK0bd9tFKII',
        name: 'GHS-HA-3.25 - PLHIV newly enrolled in HIV care started on TB preventive therapy',
    },
    3.26: {
        id: 'fOBmW8kK6cx',
        name: 'GHS-HA-3.26 - Percentage of infants born to HIV-infected mothers who are infected before 18 months',
    },
    3.27: {
        id: 'sJPfP23pR4G',
        name: 'GHS-HA-3.27 - Proportion of pregnant women tested for syphilis',
    },
    3.28: {
        id: 'T2evSkq5Nj6',
        name: 'GHS-HA-3.28 - Confirmed OPD Malaria cases per 1000 population',
    },
    3.29: {
        id: 'fQruPHq63T7',
        name: 'GHS-HA-3.29 - Percentage (%) of pregnant women receiving IPTp3',
    },
}

const withType = (ids) =>
    Object.fromEntries(
        Object.entries(ids).map(([code, entry]) => [
            code,
            { ...entry, type: INDICATOR },
        ])
    )

export const BUILTIN_INDICATOR_IDS = {
    'ghs-ha-2025': withType(REGIONAL_IDS),
    'ghs-ha-2025-district': withType(DISTRICT_IDS),
}

/** The bindings the app ships for one tool. Never null. */
export const builtinIdsFor = (frameworkId) =>
    BUILTIN_INDICATOR_IDS[frameworkId] || {}

/** True when `id` is the binding this app ships for that code. */
export const isBuiltinId = (frameworkId, code, id) =>
    Boolean(id) && builtinIdsFor(frameworkId)[code]?.id === id

/**
 * Lay an administrator's saved mapping over the bindings the app ships.
 *
 * A stored entry replaces the built-in for its code, and a stored `null` is the
 * tombstone the Admin page's Clear button writes - without it a cleared
 * built-in would simply reappear on the next read.
 */
export const withBuiltinIds = (frameworkId, stored) => {
    const merged = { ...builtinIdsFor(frameworkId) }
    Object.entries(stored || {}).forEach(([code, entry]) => {
        if (entry === null) {
            delete merged[code]
        } else if (entry) {
            merged[code] = entry
        }
    })
    return merged
}

export default BUILTIN_INDICATOR_IDS
