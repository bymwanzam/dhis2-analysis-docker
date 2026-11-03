import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/*
 * A YYYYMMDD stamp for the footer, so a screenshot says which build produced
 * it. Docker builds can pin it with BUILD_STAMP.
 */
const buildStamp =
    process.env.BUILD_STAMP ||
    new Date().toISOString().slice(0, 10).replace(/-/g, '')

// The Node server, for `npm run dev`: the dev server forwards everything that
// is not the frontend itself to it, dropping the /holistic prefix the way the
// DHIS2 Analysis proxy does.
const backend = process.env.BACKEND_URL || 'http://localhost:3000'
const toBackend = {
    target: backend,
    rewrite: (p) => p.replace(/^\/holistic/, ''),
}

/*
 * DHIS2 Analysis serves this module under /holistic/ (its
 * src/app/holistic/[...path]/route.ts proxy), so every asset and server call
 * lives under that prefix. See src/lib/api.js.
 */
const BASE = '/holistic/'

export default defineConfig({
    base: BASE,
    plugins: [react({ include: /\.(jsx?|tsx?)$/ })],
    // No PostCSS here. Set explicitly so Vite does not search upward and load
    // the DHIS2 Analysis (Tailwind) postcss.config.mjs at the repository root.
    css: { postcss: {} },
    define: {
        'process.env.DHIS2_APP_VERSION': JSON.stringify(pkg.version),
        'process.env.DHIS2_APP_BUILD': JSON.stringify(buildStamp),
    },
    server: {
        port: 5173,
        proxy: {
            '/holistic/api': toBackend,
            '/holistic/auth': toBackend,
            '/holistic/dhis2': toBackend,
            '/holistic/healthz': toBackend,
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
        chunkSizeWarningLimit: 2500,
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.{js,jsx}'],
    },
})
