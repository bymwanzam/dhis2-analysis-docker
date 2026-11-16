/** Shared number, date and label formatting. */
import { PERFORMANCE_CATEGORIES, PERFORMANCE_CATEGORY } from './constants.js'

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

export const fmtNumber = (v, digits = 2) =>
    isNum(v)
        ? v.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: digits,
          })
        : '—'

export const fmtPercent = (fraction, digits = 1) =>
    isNum(fraction) ? `${(fraction * 100).toFixed(digits)}%` : '—'

export const fmtSignedPercent = (fraction, digits = 1) => {
    if (!isNum(fraction)) {
        return '—'
    }
    const pct = fraction * 100
    return `${pct > 0 ? '+' : ''}${pct.toFixed(digits)}%`
}

export const fmtScore = (v, digits = 3) => (isNum(v) ? v.toFixed(digits) : '—')

export const fmtDateTime = (iso) => {
    if (!iso) {
        return '—'
    }
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export const fmtRelative = (iso) => {
    if (!iso) {
        return ''
    }
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) {
        return ''
    }
    const secs = Math.round((Date.now() - then) / 1000)
    if (secs < 60) {
        return 'just now'
    }
    if (secs < 3600) {
        return `${Math.floor(secs / 60)}m ago`
    }
    if (secs < 86400) {
        return `${Math.floor(secs / 3600)}h ago`
    }
    return new Date(iso).toLocaleDateString()
}

/** Outcome (-2..2) to a semantic tone used for chips and cells. */
export const outcomeTone = (outcome) => {
    if (outcome >= 2) {
        return 'positive'
    }
    if (outcome === 1) {
        return 'good'
    }
    if (outcome === 0) {
        return 'neutral'
    }
    if (outcome === -1) {
        return 'warning'
    }
    return 'negative'
}

export const signed = (n) => (isNum(n) ? (n > 0 ? `+${n}` : String(n)) : '—')

/** A 0-5 performance score to its published category. */
export const performanceCategory = (performance) => {
    const score = isNum(performance) ? performance : 0
    return (
        PERFORMANCE_CATEGORIES.find((band) => score >= band.min)?.key ||
        PERFORMANCE_CATEGORY.SEVERE
    )
}

/** The 0-5 score as it is written down: two decimals, never a bare integer. */
export const fmtPerformance = (v) => (isNum(v) ? v.toFixed(2) : '—')

/** Assessment years offered in the year selector: current year back nine. */
export const assessmentYears = (count = 10) => {
    const now = new Date().getFullYear()
    return Array.from({ length: count }, (_, i) => now - i)
}

export const csvEscape = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows) =>
    rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')

/** Trigger a client-side download of generated text. */
export const downloadText = (
    filename,
    text,
    type = 'text/csv;charset=utf-8;'
) => {
    // Excel needs a UTF-8 BOM to read accented names correctly.
    const blob = new Blob([`\uFEFF${text}`], { type })
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
 * Drops a UTF-8 byte order mark from text read back off disk. Excel writes one
 * into every CSV it saves, and it would otherwise become part of the first
 * column's header.
 */
export const stripBom = (text) =>
    text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
