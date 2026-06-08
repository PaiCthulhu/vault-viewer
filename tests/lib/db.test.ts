import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// Uses in-memory database for tests — does not affect users.db
let testDb: Database.Database

function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE vault_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vault_slug TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, vault_slug)
    );
  `)
  return db
}

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { testDb.close() })

describe('users', () => {
  it('cria e recupera usuário pelo username', () => {
    testDb.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('will', 'hash123')
    const user = testDb.prepare('SELECT * FROM users WHERE username = ?').get('will') as { username: string; is_admin: number }
    expect(user.username).toBe('will')
    expect(user.is_admin).toBe(0)
  })

  it('username é único', () => {
    testDb.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('will', 'hash')
    expect(() =>
      testDb.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('will', 'hash2'),
    ).toThrow()
  })

  it('cascade delete remove permissões ao deletar usuário', () => {
    testDb.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('joao', 'hash')
    const user = testDb.prepare('SELECT id FROM users WHERE username = ?').get('joao') as { id: number }
    testDb.prepare('INSERT INTO vault_permissions (user_id, vault_slug) VALUES (?, ?)').run(user.id, 'drachegotter')
    testDb.prepare('DELETE FROM users WHERE id = ?').run(user.id)
    const perms = testDb.prepare('SELECT * FROM vault_permissions WHERE user_id = ?').all(user.id)
    expect(perms).toHaveLength(0)
  })
})

describe('vault_permissions', () => {
  it('atribui e recupera permissões', () => {
    testDb.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('maria', 'hash')
    const user = testDb.prepare('SELECT id FROM users WHERE username = ?').get('maria') as { id: number }
    testDb.prepare('INSERT INTO vault_permissions (user_id, vault_slug) VALUES (?, ?)').run(user.id, 'drachegotter')
    const perms = testDb.prepare('SELECT vault_slug FROM vault_permissions WHERE user_id = ?').all(user.id) as { vault_slug: string }[]
    expect(perms.map(p => p.vault_slug)).toContain('drachegotter')
  })
})
