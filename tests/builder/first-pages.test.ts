import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { FIRST_LIMIT, readPrevScanMs, selectFirstPages } from '../../builder/first-pages'
import { noteTime } from '../../builder/scanner'

const notes = [
  { path: 'A', t: 300 },
  { path: 'B', t: 200 },
  { path: 'C', t: 100 },
  { path: 'D', t: 50 },
]

describe('selectFirstPages', () => {
  it('explícitos primeiro, depois alteradas da mais recente, sem repetir', () => {
    expect(selectFirstPages(['B'], notes, 60)).toEqual(['B', 'A', 'C'])
  })

  it('empate de t é decidido pelo caminho em ordem crescente', () => {
    const iguais = [{ path: 'Z', t: 100 }, { path: 'M', t: 100 }]
    expect(selectFirstPages([], iguais, 0)).toEqual(['M', 'Z'])
  })

  it('limite de 20 conta as duas origens', () => {
    const muitas = Array.from({ length: 31 }, (_, i) => ({ path: `N${i}`, t: 1000 + i }))
    const r = selectFirstPages(['N0'], muitas, 0)
    expect(FIRST_LIMIT).toBe(20)
    expect(r).toHaveLength(20)
    expect(r[0]).toBe('N0')
  })

  it('sem index anterior só valem os explícitos', () => {
    expect(selectFirstPages(['B', 'nada'], notes, null)).toEqual(['B'])
  })

  it('explícito sem diferenciar caixa e desconhecido ignorado', () => {
    expect(selectFirstPages(['pasta/foo', 'nada'], [{ path: 'Pasta/Foo', t: 1 }], null)).toEqual(['Pasta/Foo'])
  })
})

describe('readPrevScanMs', () => {
  const TMP = path.join(os.tmpdir(), 'first-pages-test-' + Math.random().toString(36).slice(2))
  afterEach(() => fs.rmSync(TMP, { recursive: true, force: true }))

  it('prefere startedAt, cai para builtAt e devolve null sem arquivo', () => {
    fs.mkdirSync(TMP, { recursive: true })
    const f = path.join(TMP, 'index.json')
    expect(readPrevScanMs(f)).toBeNull()

    fs.writeFileSync(f, JSON.stringify({ builtAt: '2026-01-02T00:00:00Z', startedAt: '2026-01-01T00:00:00Z' }))
    expect(readPrevScanMs(f)).toBe(Date.parse('2026-01-01T00:00:00Z'))

    fs.writeFileSync(f, JSON.stringify({ builtAt: '2026-01-02T00:00:00Z' }))
    expect(readPrevScanMs(f)).toBe(Date.parse('2026-01-02T00:00:00Z'))

    fs.writeFileSync(f, JSON.stringify({ builtAt: 'lixo' }))
    expect(readPrevScanMs(f)).toBeNull()
    fs.writeFileSync(f, '{quebrado')
    expect(readPrevScanMs(f)).toBeNull()
  })
})

describe('noteTime', () => {
  it('é o maior entre mtime, ctime e birthtime', () => {
    expect(noteTime({ mtimeMs: 1, ctimeMs: 5, birthtimeMs: 3 })).toBe(5)
    expect(noteTime({ mtimeMs: 1, ctimeMs: 5, birthtimeMs: 9 })).toBe(9)
  })
})
