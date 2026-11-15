import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { VaultConfig } from '@/types'

// O build que a página pede roda pelo runRebuild de verdade; só o processo do builder é falso.
type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }

const calls: FakeChild[] = []

function fakeSpawn() {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  calls.push(child)
  return child
}

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, default: { ...actual, spawn: fakeSpawn }, spawn: fakeSpawn }
})

import { isPending } from '@/lib/pending-page'

let root: string
let vault: VaultConfig

beforeEach(() => {
  calls.length = 0
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-log-'))
  const vaultDir = path.join(root, 'vault')
  fs.mkdirSync(vaultDir, { recursive: true })
  fs.writeFileSync(path.join(vaultDir, 'Nova.md'), '# x')
  vault = { slug: 'vault-do-log', name: 'v', path: vaultDir, description: '', homePage: '', coverImage: null }
  // Sem data/vault-do-log/index.json: nenhum build olhou a nota, então a página pede um.
  vi.spyOn(process, 'cwd').mockReturnValue(root)
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('build pedido pela página pendente', () => {
  it('que falha → uma linha de log só', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const noBuild = () => ({ running: null, queued: false, first: [], lastAttemptStartedAt: null })
    expect(isPending(vault, 'Nova', { trigger: true }, { buildState: noBuild })).toBe(true)
    expect(calls).toHaveLength(1)

    calls[0].stderr.emit('data', Buffer.from('falhou a nota nova'))
    calls[0].emit('close', 1)
    await flush()
    // Conta pelo slug, não pelo output: uma linha repetida sem o output também conta.
    const lines = err.mock.calls.map((c) => c.map(String).join(' ')).filter((l) => l.includes('vault-do-log'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('falhou a nota nova')
  })
})
