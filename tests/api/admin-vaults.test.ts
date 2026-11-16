import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: async () => null }))

import { PATCH } from '@/app/api/admin/vaults/[slug]/route'
import { POST } from '@/app/api/admin/vaults/route'

let tmp: string
let vaultDir: string
let configFile: string
let cwdSpy: ReturnType<typeof vi.spyOn>

function readVaults(): Array<Record<string, unknown>> {
  return JSON.parse(fs.readFileSync(configFile, 'utf-8')).vaults
}

function req(body: unknown) {
  return new Request('http://test.local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

function patch(body: unknown) {
  return PATCH(req(body), { params: Promise.resolve({ slug: 'my-vault' }) })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-vaults-'))
  vaultDir = path.join(tmp, 'vault')
  fs.mkdirSync(vaultDir)
  configFile = path.join(tmp, 'vaults.config.json')
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      vaults: [
        { slug: 'my-vault', name: 'My Vault', path: vaultDir, description: '', homePage: '', coverImage: null },
      ],
    }),
  )
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp)
})

afterEach(() => {
  cwdSpy.mockRestore()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('flag comments do vault', () => {
  it('PATCH grava comments true e depois false', async () => {
    let res = await patch({ comments: true })
    expect(res.status).toBe(200)
    expect(readVaults()[0].comments).toBe(true)

    res = await patch({ comments: false })
    expect(res.status).toBe(200)
    expect(readVaults()[0].comments).toBe(false)
  })

  it('PATCH recusa comments não booleano', async () => {
    const before = fs.readFileSync(configFile, 'utf-8')
    const res = await patch({ comments: 'sim' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('comments deve ser booleano')
    expect(fs.readFileSync(configFile, 'utf-8')).toBe(before)
  })

  it('PATCH sem comments não cria a chave', async () => {
    const res = await patch({ name: 'Outro' })
    expect(res.status).toBe(200)
    const v = readVaults()[0]
    expect(v.name).toBe('Outro')
    expect('comments' in v).toBe(false)
  })

  it('POST grava comments, padrão false', async () => {
    let res = await POST(req({ name: 'Com', path: vaultDir, comments: true }))
    expect(res.status).toBe(200)
    expect(readVaults().find((v) => v.name === 'Com')?.comments).toBe(true)

    res = await POST(req({ name: 'Sem', path: vaultDir }))
    expect(res.status).toBe(200)
    expect(readVaults().find((v) => v.name === 'Sem')?.comments).toBe(false)

    const before = fs.readFileSync(configFile, 'utf-8')
    res = await POST(req({ name: 'Ruim', path: vaultDir, comments: 1 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('comments deve ser booleano')
    expect(fs.readFileSync(configFile, 'utf-8')).toBe(before)
  })
})
