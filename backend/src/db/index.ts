import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from './schema.js'

const databasePath = process.env['DATABASE_PATH']
if (!databasePath?.trim() || databasePath !== databasePath.trim()) throw new Error('DATABASE_PATH is required and must not have surrounding whitespace')
mkdirSync(dirname(resolve(databasePath)), { recursive: true })

export const sqlite = new Database(databasePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')

export const db = drizzle(sqlite, { schema })
