import pg from 'pg'

/**
 * The app's own key/value store, replacing the DHIS2 datastore namespace it
 * used when it ran inside DHIS2. Keys are the same (`assessment-2025-<ou>`,
 * `settings`, `periods`, ...) so a datastore backup imports unchanged.
 *
 * Every entry carries a version that goes up by one on each write. A write
 * names the version it was based on, and is refused if somebody else has
 * written since — which is what stops two people editing the same assessment
 * from silently overwriting each other.
 */

export class ConflictError extends Error {
    constructor(current) {
        super('This record was changed by someone else since it was loaded.')
        this.name = 'ConflictError'
        this.current = current
    }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS store_entries (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    version     integer NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);

-- Every version ever written, so a disputed figure can be traced to who wrote
-- it and when, independently of the history the client keeps in the record.
CREATE TABLE IF NOT EXISTS store_audit (
    id          bigserial PRIMARY KEY,
    key         text NOT NULL,
    version     integer,
    action      text NOT NULL,
    at          timestamptz NOT NULL DEFAULT now(),
    by_user     text,
    value       jsonb
);
CREATE INDEX IF NOT EXISTS store_audit_key_idx ON store_audit (key, id);
`

const rowToEntry = (row) =>
    row
        ? {
              key: row.key,
              value: row.value,
              version: row.version,
              updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
              updatedBy: row.updated_by,
          }
        : null

/** Postgres-backed store. */
export const createPgStore = async ({ databaseUrl, pool: given }) => {
    const pool = given || new pg.Pool({ connectionString: databaseUrl })
    await pool.query(SCHEMA)

    const tx = async (fn) => {
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const result = await fn(client)
            await client.query('COMMIT')
            return result
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {})
            throw e
        } finally {
            client.release()
        }
    }

    const get = async (key, client = pool) => {
        const { rows } = await client.query(
            'SELECT key, value, version, updated_at, updated_by FROM store_entries WHERE key = $1',
            [key]
        )
        return rowToEntry(rows[0])
    }

    return {
        kind: 'postgres',
        list: async () => {
            const { rows } = await pool.query(
                'SELECT key FROM store_entries ORDER BY key'
            )
            return rows.map((r) => r.key)
        },
        get: (key) => get(key),
        /**
         * `expectedVersion`: a number to require that version, 0 to require
         * that the key does not exist yet, undefined to write regardless.
         */
        put: (key, value, { expectedVersion, user } = {}) =>
            tx(async (client) => {
                const json = JSON.stringify(value)
                let rows
                if (expectedVersion === undefined) {
                    ;({ rows } = await client.query(
                        `INSERT INTO store_entries (key, value, version, updated_by)
                         VALUES ($1, $2, 1, $3)
                         ON CONFLICT (key) DO UPDATE
                           SET value = EXCLUDED.value,
                               version = store_entries.version + 1,
                               updated_at = now(),
                               updated_by = EXCLUDED.updated_by
                         RETURNING key, value, version, updated_at, updated_by`,
                        [key, json, user || null]
                    ))
                } else if (expectedVersion === 0) {
                    ;({ rows } = await client.query(
                        `INSERT INTO store_entries (key, value, version, updated_by)
                         VALUES ($1, $2, 1, $3)
                         ON CONFLICT (key) DO NOTHING
                         RETURNING key, value, version, updated_at, updated_by`,
                        [key, json, user || null]
                    ))
                } else {
                    ;({ rows } = await client.query(
                        `UPDATE store_entries
                           SET value = $2, version = version + 1,
                               updated_at = now(), updated_by = $3
                         WHERE key = $1 AND version = $4
                         RETURNING key, value, version, updated_at, updated_by`,
                        [key, json, user || null, expectedVersion]
                    ))
                }
                if (!rows.length) {
                    throw new ConflictError(await get(key, client))
                }
                const entry = rowToEntry(rows[0])
                await client.query(
                    `INSERT INTO store_audit (key, version, action, by_user, value)
                     VALUES ($1, $2, 'WRITE', $3, $4)`,
                    [key, entry.version, user || null, json]
                )
                return entry
            }),
        remove: (key, { user } = {}) =>
            tx(async (client) => {
                const { rowCount } = await client.query(
                    'DELETE FROM store_entries WHERE key = $1',
                    [key]
                )
                if (rowCount) {
                    await client.query(
                        `INSERT INTO store_audit (key, action, by_user) VALUES ($1, 'DELETE', $2)`,
                        [key, user || null]
                    )
                }
                return rowCount > 0
            }),
        ping: async () => {
            await pool.query('SELECT 1')
        },
        close: () => pool.end(),
    }
}

/** In-memory store with the same behaviour, for tests and local trials. */
export const createMemoryStore = (initial = {}) => {
    const entries = new Map()
    const audit = []
    const now = () => new Date().toISOString()
    Object.entries(initial).forEach(([key, value]) =>
        entries.set(key, {
            key,
            value,
            version: 1,
            updatedAt: now(),
            updatedBy: null,
        })
    )
    const clone = (e) => (e ? structuredClone(e) : null)

    return {
        kind: 'memory',
        audit,
        list: async () => [...entries.keys()].sort(),
        get: async (key) => clone(entries.get(key)),
        put: async (key, value, { expectedVersion, user } = {}) => {
            const existing = entries.get(key)
            const ok =
                expectedVersion === undefined ||
                (expectedVersion === 0 && !existing) ||
                (existing && existing.version === expectedVersion)
            if (!ok) {
                throw new ConflictError(clone(existing))
            }
            const entry = {
                key,
                value: structuredClone(value),
                version: (existing?.version || 0) + 1,
                updatedAt: now(),
                updatedBy: user || null,
            }
            entries.set(key, entry)
            audit.push({ key, version: entry.version, action: 'WRITE', user })
            return clone(entry)
        },
        remove: async (key, { user } = {}) => {
            const had = entries.delete(key)
            if (had) {
                audit.push({ key, action: 'DELETE', user })
            }
            return had
        },
        ping: async () => {},
        close: async () => {},
    }
}
