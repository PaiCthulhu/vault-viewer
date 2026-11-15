import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseArgs, buildAll } from '../../builder/cli'
import type { VaultConfig } from '../../types'

const v = (slug: string) => ({ slug, path: '/nao/existe/' + slug }) as unknown as VaultConfig

describe('parseArgs', () => {
  it('--first consome o argumento seguinte, mesmo que pareça flag', () => {
    expect(parseArgs(['--first', '--all', '--vault', 'x'])).toEqual({ vault: 'x', first: ['--all'], all: false })
  })

  it('aceita a forma montada por lib/rebuild.ts', () => {
    expect(parseArgs(['--first', 'A/b', '--first', 'C', '--vault', 'v'])).toEqual({
      vault: 'v',
      first: ['A/b', 'C'],
      all: false,
    })
  })

  it('--all e --vault sem valor', () => {
    expect(parseArgs(['--all']).all).toBe(true)
    expect(parseArgs(['--vault']).vault).toBe('')
    expect(parseArgs([]).vault).toBeUndefined()
  })
})

describe('buildAll', () => {
  afterEach(() => vi.restoreAllMocks())

  it('um vault que falha não impede os seguintes e a falha é devolvida', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const built: string[] = []
    const failed = await buildAll([v('a'), v('b')], async vault => {
      if (vault.slug === 'a') throw new Error('sem pasta')
      built.push(vault.slug)
    })
    expect(built).toEqual(['b'])
    expect(failed).toEqual(['a'])
  })

  it('sem falhas devolve lista vazia', async () => {
    expect(await buildAll([v('a')], async () => {})).toEqual([])
  })
})
