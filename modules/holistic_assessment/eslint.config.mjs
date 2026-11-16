/*
 * ESLint 8 looks upward for a flat config and would otherwise pick up the
 * DHIS2 Analysis one at the repository root, which needs packages this module
 * does not install. This file stops the search here and loads the module's own
 * rules, which stay in .eslintrc.json.
 */
import { readFileSync } from 'node:fs'
import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'

const compat = new FlatCompat({
    baseDirectory: import.meta.dirname,
    recommendedConfig: js.configs.recommended,
})

const { root: _root, ...legacy } = JSON.parse(
    readFileSync(new URL('./.eslintrc.json', import.meta.url), 'utf8')
)

export default compat.config(legacy)
