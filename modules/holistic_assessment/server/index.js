import { createApp } from './app.js'
import { assertConfig, loadConfig } from './config.js'
import { createDhis2Client } from './dhis2.js'
import { createPgStore } from './store.js'

const config = loadConfig()
assertConfig(config)

if (config.dhis2Insecure) {
    // Only for a DHIS2 instance with a self-signed certificate.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    console.warn('DHIS2_INSECURE is set: TLS certificates are not being verified.')
}

/** Postgres may still be starting when the container comes up. */
const connectWithRetry = async (attempts = 20) => {
    for (let i = 1; ; i++) {
        try {
            return await createPgStore({ databaseUrl: config.databaseUrl })
        } catch (e) {
            if (i >= attempts) {
                throw e
            }
            console.warn(`Database not ready (${e.message}); retrying in 3s`)
            await new Promise((r) => setTimeout(r, 3000))
        }
    }
}

const store = await connectWithRetry()
const dhis2 = createDhis2Client()
const app = createApp({ config, store, dhis2 })

const server = app.listen(config.port, () => {
    console.info(
        `GHS Holistic Assessment listening on :${config.port} — DHIS2 ${config.dhis2Url || "from each viewer's DHIS2 Analysis connection"}`
    )
})

const shutdown = (signal) => {
    console.info(`${signal} received, shutting down`)
    server.close(async () => {
        await store.close()
        process.exit(0)
    })
    setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
