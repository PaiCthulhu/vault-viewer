import Database from 'better-sqlite3'
import path from 'path'
import type { UserRow, VaultLevel, VaultPermission } from '@/types'

const DB_PATH = path.join(process.cwd(), 'users.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    // `_db` só recebe a conexão depois do schema: se algo lançar no meio (ex.: disco cheio
    // no ALTER), a conexão é fechada e a próxima chamada tenta de novo, em vez de receber
    // um banco sem schema.
    const db = new Database(DB_PATH)
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      applySchema(db)
    } catch (e) {
      // Um erro do close não pode esconder o erro original.
      try {
        db.close()
      } catch {
        /* segue com o erro original */
      }
      throw e
    }
    _db = db
  }
  return _db
}

export function applySchema(db: Database.Database): void {
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
      level      TEXT NOT NULL DEFAULT 'reader' CHECK (level IN ('reader','editor')),
      PRIMARY KEY (user_id, vault_slug)
    );
  `)

  // Banco antigo: acrescenta a coluna do nome de exibição (nula = sem nome)
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'display_name')) {
    db.exec('ALTER TABLE users ADD COLUMN display_name TEXT')
  }

  // Banco antigo: acrescenta o nível de acesso; os acessos que já existiam viram reader
  const permCols = db.prepare('PRAGMA table_info(vault_permissions)').all() as { name: string }[]
  if (!permCols.some((c) => c.name === 'level')) {
    db.exec(
      "ALTER TABLE vault_permissions ADD COLUMN level TEXT NOT NULL DEFAULT 'reader' CHECK (level IN ('reader','editor'))",
    )
  }
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
  displayName: string | null = null,
): UserRow {
  return getDb()
    .prepare(
      'INSERT INTO users (username, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?) RETURNING *',
    )
    .get(username, passwordHash, isAdmin ? 1 : 0, displayName) as UserRow
}

// username → display_name, só para usernames que existem (null = usuário sem nome)
export function dbGetDisplayNames(usernames: string[]): Record<string, string | null> {
  const unique = [...new Set(usernames.filter((u) => u !== ''))]
  if (unique.length === 0) return {}
  const rows = getDb()
    .prepare(
      `SELECT username, display_name FROM users WHERE username IN (${unique.map(() => '?').join(', ')})`,
    )
    .all(...unique) as { username: string; display_name: string | null }[]
  const out: Record<string, string | null> = {}
  for (const r of rows) out[r.username] = r.display_name ?? null
  return out
}

export function dbUpdateUser(
  id: number,
  fields: { username?: string; passwordHash?: string; displayName?: string | null },
): void {
  const db = getDb()
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (fields.displayName !== undefined) {
    sets.push('display_name = ?')
    params.push(fields.displayName)
  }
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

export function dbGetUserVaultPermissions(userId: number): VaultPermission[] {
  const rows = getDb()
    .prepare('SELECT vault_slug, level FROM vault_permissions WHERE user_id = ? ORDER BY vault_slug')
    .all(userId) as { vault_slug: string; level: VaultLevel }[]
  return rows.map((r) => ({ slug: r.vault_slug, level: r.level }))
}

// Troca todos os acessos do usuário. INSERT simples: slug repetido ou nível fora do CHECK
// lança e a transação desfaz tudo.
export function dbSetUserPermissions(userId: number, perms: VaultPermission[]): void {
  const db = getDb()
  const del = db.prepare('DELETE FROM vault_permissions WHERE user_id = ?')
  const ins = db.prepare(
    'INSERT INTO vault_permissions (user_id, vault_slug, level) VALUES (?, ?, ?)',
  )
  db.transaction(() => {
    del.run(userId)
    for (const p of perms) ins.run(userId, p.slug, p.level)
  })()
}

// Apaga os acessos de todos os usuários a um vault (slug exato). Devolve quantos saíram.
// O DELETE do vault chama depois de tirá-lo da config: o slug é determinístico, e um vault
// recriado com o mesmo nome herdaria os acessos antigos, editor inclusive.
export function dbDeleteVaultPermissions(vaultSlug: string): number {
  return getDb().prepare('DELETE FROM vault_permissions WHERE vault_slug = ?').run(vaultSlug).changes
}

// null = sem acesso ao vault
export function dbGetUserVaultLevel(userId: number, vaultSlug: string): VaultLevel | null {
  const row = getDb()
    .prepare('SELECT level FROM vault_permissions WHERE user_id = ? AND vault_slug = ?')
    .get(userId, vaultSlug) as { level: VaultLevel } | undefined
  return row ? row.level : null
}

export function dbUserHasVaultAccess(userId: number, vaultSlug: string): boolean {
  const row = getDb()
    .prepare(
      'SELECT 1 FROM vault_permissions WHERE user_id = ? AND vault_slug = ?',
    )
    .get(userId, vaultSlug)
  return row !== undefined
}
