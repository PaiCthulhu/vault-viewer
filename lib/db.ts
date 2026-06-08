import Database from 'better-sqlite3'
import path from 'path'
import type { UserRow } from '@/types'

const DB_PATH = path.join(process.cwd(), 'users.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    applySchema(_db)
  }
  return _db
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vault_permissions (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vault_slug TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, vault_slug)
    );
  `)
}

// ─── Users ────────────────────────────────────────────────────────────────────

export function dbGetUserByUsername(username: string) {
  return getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username) as UserRow | undefined
}

export function dbGetUserById(id: number) {
  return getDb()
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(id) as UserRow | undefined
}

export function dbGetAllUsers(): UserRow[] {
  return getDb()
    .prepare('SELECT * FROM users ORDER BY created_at ASC')
    .all() as UserRow[]
}

export function dbCreateUser(
  username: string,
  passwordHash: string,
  isAdmin = false,
): UserRow {
  return getDb()
    .prepare(
      'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?) RETURNING *',
    )
    .get(username, passwordHash, isAdmin ? 1 : 0) as UserRow
}

export function dbUpdateUser(
  id: number,
  fields: { username?: string; passwordHash?: string },
): void {
  const db = getDb()
  const sets: string[] = []
  const params: (string | number)[] = []
  if (fields.username !== undefined) {
    sets.push('username = ?')
    params.push(fields.username)
  }
  if (fields.passwordHash !== undefined) {
    sets.push('password_hash = ?')
    params.push(fields.passwordHash)
  }
  if (sets.length === 0) return
  params.push(id)
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function dbDeleteUser(id: number): void {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
}

// ─── Permissions ──────────────────────────────────────────────────────────────

export function dbGetUserPermissions(userId: number): string[] {
  const rows = getDb()
    .prepare('SELECT vault_slug FROM vault_permissions WHERE user_id = ?')
    .all(userId) as { vault_slug: string }[]
  return rows.map((r) => r.vault_slug)
}

export function dbSetUserPermissions(userId: number, vaultSlugs: string[]): void {
  const db = getDb()
  const del = db.prepare('DELETE FROM vault_permissions WHERE user_id = ?')
  const ins = db.prepare(
    'INSERT OR IGNORE INTO vault_permissions (user_id, vault_slug) VALUES (?, ?)',
  )
  db.transaction(() => {
    del.run(userId)
    for (const slug of vaultSlugs) ins.run(userId, slug)
  })()
}

export function dbUserHasVaultAccess(userId: number, vaultSlug: string): boolean {
  const row = getDb()
    .prepare(
      'SELECT 1 FROM vault_permissions WHERE user_id = ? AND vault_slug = ?',
    )
    .get(userId, vaultSlug)
  return row !== undefined
}
