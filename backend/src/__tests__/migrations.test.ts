import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const paths: string[] = []
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true })
})

describe('database migrations', () => {
  it('applies from empty SQLite and enforces durable identity indexes', () => {
    const path = join(tmpdir(), `glocke-migration-${randomUUID()}.db`)
    paths.push(path)
    const sqlite = new Database(path)
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    migrate(drizzle(sqlite), { migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) })

    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining(['users', 'inbox_events', 'notifications']))
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)

    sqlite.prepare(`INSERT INTO inbox_events
      (source, event_id, user_id, payload_hash, envelope, status, accepted_at)
      VALUES ('tafel', 'event-1', 'user-1', 'hash', '{}', 'pending', 1)`).run()
    expect(() => sqlite.prepare(`INSERT INTO inbox_events
      (source, event_id, user_id, payload_hash, envelope, status, accepted_at)
      VALUES ('tafel', 'event-1', 'user-1', 'other', '{}', 'pending', 2)`).run()).toThrow()
    expect(() => sqlite.prepare(`INSERT INTO inbox_events
      (source, event_id, user_id, payload_hash, envelope, status, accepted_at)
      VALUES ('zettel', 'event-1', 'user-1', 'other', '{}', 'pending', 2)`).run()).not.toThrow()
    sqlite.close()
  })

  it('durably clears action URLs stored before registry-controlled rendering', () => {
    const path = join(tmpdir(), `glocke-migration-upgrade-${randomUUID()}.db`)
    paths.push(path)
    const sqlite = new Database(path)
    const migrationsFolder = fileURLToPath(new URL('../db/migrations', import.meta.url))
    const migrations = readMigrationFiles({ migrationsFolder })
    const initial = migrations[0]!
    for (const statement of initial.sql) sqlite.prepare(statement).run()
    sqlite.exec(`CREATE TABLE "__drizzle_migrations" (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric
    )`)
    sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
      .run(initial.hash, initial.folderMillis)
    sqlite.prepare(`INSERT INTO notifications
      (id, source, event_id, user_id, type, title, body, action_url, created_at)
      VALUES ('legacy', 'tafel', 'legacy-event', 'user-1', 'legacy', 'Legacy', 'Legacy',
        'https://attacker.invalid/collect', 1)`).run()

    migrate(drizzle(sqlite), { migrationsFolder })

    expect(sqlite.prepare("SELECT action_url AS actionUrl FROM notifications WHERE id = 'legacy'").get())
      .toEqual({ actionUrl: null })
    sqlite.close()
  })
})
