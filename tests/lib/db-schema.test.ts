import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'

type DbModule = typeof import('@/lib/db')

let tmpDir: string
let db: DbModule

beforeAll(async () => {
  // O getDb abre users.db em process.cwd(): aponta para uma pasta temporária
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-db-schema-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  db = await import('@/lib/db')
})

afterAll(() => {
  db.getDb().close()
  vi.restoreAllMocks()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function columns(d: Database.Database): string[] {
  return (d.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name)
}

describe('schema de users', () => {
  it('applySchema em :memory: duas vezes não falha e cria display_name', () => {
    const mem = new Database(':memory:')
    db.applySchema(mem)
    db.applySchema(mem)
    expect(columns(mem).filter((c) => c === 'display_name')).toHaveLength(1)
    mem.close()
  })

  it('banco antigo sem a coluna ganha display_name e mantém os usuários', () => {
    const mem = new Database(':memory:')
    mem.exec(`
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    mem.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('ana', 'h')
    expect(columns(mem)).not.toContain('display_name')

    db.applySchema(mem)
    db.applySchema(mem)

    expect(columns(mem).filter((c) => c === 'display_name')).toHaveLength(1)
    const row = mem.prepare('SELECT * FROM users WHERE username = ?').get('ana') as {
      username: string
      display_name: string | null
    }
    expect(row.username).toBe('ana')
    expect(row.display_name).toBeNull()
    mem.close()
  })
})

describe('getDb', () => {
  // Banco em que o applySchema lança (uma VIEW chamada users faz o ALTER TABLE falhar),
  // com um `@/lib/db` novo apontando para ele.
  async function bancoQuebrado(): Promise<{ dir: string; file: string; fresh: DbModule }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-db-open-'))
    const file = path.join(dir, 'users.db')
    const pre = new Database(file)
    pre.exec('CREATE VIEW users AS SELECT 1 AS id')
    pre.close()
    vi.mocked(process.cwd).mockReturnValue(dir)
    vi.resetModules()
    const fresh: DbModule = await import('@/lib/db')
    return { dir, file, fresh }
  }

  function limpar(dir: string) {
    vi.mocked(process.cwd).mockReturnValue(tmpDir)
    // Limpeza sem lançar: com uma conexão vazada o Windows não deixa apagar o arquivo, e
    // o erro daqui esconderia a asserção que falhou.
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* fica na pasta temporária */
    }
  }

  it('se applySchema lança, fecha a conexão e a próxima chamada abre de novo com o schema', async () => {
    const { dir, file, fresh } = await bancoQuebrado()
    const close = vi.spyOn(Database.prototype, 'close')
    try {
      expect(() => fresh.getDb()).toThrow('Cannot add a column to a view')
      expect(close).toHaveBeenCalledTimes(1)

      // Conserta o banco por fora: a próxima chamada não pode devolver a conexão sem schema.
      const fix = new Database(file)
      fix.exec('DROP VIEW users')
      fix.close()
      const conn = fresh.getDb()
      expect(columns(conn)).toContain('display_name')
      expect(fresh.getDb()).toBe(conn)
      conn.close()
    } finally {
      close.mockRestore()
      limpar(dir)
    }
  })

  it('um erro no close não esconde o erro do applySchema', async () => {
    const { dir, fresh } = await bancoQuebrado()
    const realClose = Database.prototype.close
    // Fecha de verdade (para não prender o arquivo) e lança depois.
    const close = vi.spyOn(Database.prototype, 'close').mockImplementationOnce(function (this: Database.Database) {
      realClose.call(this)
      throw new Error('close falhou')
    })
    try {
      expect(() => fresh.getDb()).toThrow('Cannot add a column to a view')
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      close.mockRestore()
      limpar(dir)
    }
  })
})

describe('display_name no banco', () => {
  it('dbGetDisplayNames só devolve usuários existentes', () => {
    db.dbCreateUser('ana', 'h', false, 'Ana Souza')
    db.dbCreateUser('bia', 'h')
    expect(db.dbGetDisplayNames(['ana', 'bia', 'zé', 'ana', ''])).toEqual({
      ana: 'Ana Souza',
      bia: null,
    })
    expect(db.dbGetDisplayNames([])).toEqual({})
  })

  it('dbUpdateUser grava e limpa displayName', () => {
    const u = db.dbCreateUser('caio', 'h')
    db.dbUpdateUser(u.id, { displayName: 'Ana' })
    expect(db.dbGetUserById(u.id)?.display_name).toBe('Ana')
    db.dbUpdateUser(u.id, { username: 'caio2' })
    expect(db.dbGetUserById(u.id)?.display_name).toBe('Ana')
    db.dbUpdateUser(u.id, { displayName: null })
    expect(db.dbGetUserById(u.id)?.display_name).toBeNull()
  })
})
