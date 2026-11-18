import { describe, it, expect } from 'vitest'
import type { RelationEntry } from '../../builder/types'
import { menuEntries } from '../../lib/property-edit'
import { IMAGE_PATH_RE } from '../../builder/plugins/properties'
import {
  IMAGE_EXT, candidateOf, isValidNoteName, relationCreate, relationEnterPick, relationExclude, removeHints,
} from '../../lib/property-relation'

const rel: RelationEntry = {
  candidates: [
    { link: '[[Alpha]]', label: 'Alpha', path: 'Games/Alpha' },
    { link: '[[Games/Sub/Delta]]', label: 'Delta', path: 'Games/Sub/Delta' },
    { link: '[[Ação]]', label: 'Ação', path: 'Games/Ação' },
  ],
  resolved: { '[[alpha|A]]': 'Games/Alpha' },
}

describe('candidateOf', () => {
  it('usa resolved, depois o link do candidato, senão null', () => {
    expect(candidateOf('[[alpha|A]]', rel)).toBe('Games/Alpha')
    expect(candidateOf(' [[Alpha]] ', rel)).toBe('Games/Alpha')
    expect(candidateOf('[[Fora]]', rel)).toBeNull()
  })
  it('__proto__ e constructor são chaves comuns', () => {
    expect(candidateOf('constructor', rel)).toBeNull()
    expect(candidateOf('__proto__', rel)).toBeNull()
  })
})

describe('isValidNoteName', () => {
  it.each([
    'a[b', 'a]b', 'a|b', 'a#b', 'a^b', 'a/b', 'a\\b', 'a<b', 'a:b', 'a"b', 'a?b', 'a*b',
    'a\u0001b', 'a\u2028b', '.a', 'a.', 'ç'.repeat(128), 'foto.png', '',
  ])('recusa %j', name => {
    expect(isValidNoteName(name)).toBe(false)
  })
  it('aceita nomes comuns', () => {
    expect(isValidNoteName('Nova nota')).toBe(true)
    expect(isValidNoteName('Ação 2')).toBe(true)
    expect(isValidNoteName('ç'.repeat(127))).toBe(true)
  })
})

describe('relationCreate', () => {
  it('recusa o que já existe como nota ou como item, sem caixa', () => {
    expect(relationCreate('alpha', rel, [])).toBeNull()
    expect(relationCreate('games/sub/delta', rel, [])).toBeNull()
    expect(relationCreate('delta', rel, [])).toBeNull()
    expect(relationCreate('Nova', rel, ['[[nova]]'])).toBeNull()
  })
  it('cria [[nome]] aparado, com ou sem índice', () => {
    expect(relationCreate('Nova', rel, [])).toBe('[[Nova]]')
    expect(relationCreate('  Nova ', null, [])).toBe('[[Nova]]')
  })
  it('recusa nome inválido', () => {
    expect(relationCreate('a|b', rel, [])).toBeNull()
  })
})

describe('relationExclude', () => {
  it('lista os links dos candidatos já citados, por qualquer grafia', () => {
    expect(relationExclude(rel, ['[[alpha|A]]', '[[Games/Sub/Delta]]', '[[Fora]]']))
      .toEqual(['[[Alpha]]', '[[Games/Sub/Delta]]'])
    expect(relationExclude(null, ['[[Alpha]]'])).toEqual([])
  })
})

describe('relationEnterPick', () => {
  const entries = menuEntries(rel.candidates.map(c => c.link))
  it('candidato já citado por outra grafia não entra', () => {
    expect(relationEnterPick(entries, 'Alpha', ['[[alpha|A]]'], rel)).toEqual({ chosen: true })
  })
  it('acha o candidato sem acento nem caixa', () => {
    expect(relationEnterPick(entries, 'acao', [], rel)).toEqual({ value: '[[Ação]]' })
  })
  it('texto novo vira [[texto]]; inválido não entra', () => {
    expect(relationEnterPick(entries, 'Nova', [], rel)).toEqual({ value: '[[Nova]]' })
    expect(relationEnterPick(entries, 'a#b', [], rel)).toBeNull()
  })
  it('nome de nota já escolhida (item cru) conta como escolhido', () => {
    expect(relationEnterPick(entries, 'nova', ['[[Nova]]'], rel)).toEqual({ chosen: true })
  })
})

describe('IMAGE_EXT × IMAGE_PATH_RE', () => {
  it('as duas regras de imagem concordam', () => {
    const names = ['a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.avif',
      'a.bmp', 'a.tiff', 'a.md', 'a.png.txt', 'png']
    for (const n of names) expect(IMAGE_EXT.test(n), n).toBe(IMAGE_PATH_RE.test(n))
  })
})

describe('removeHints', () => {
  const hintOf = (i: string) => (i === '[[Alpha]]' ? 'Games/Alpha' : i === '[[Games/Alpha|Alpha]]' ? 'Games/Alpha' : i)
  it('null para nome único; dica para repetido', () => {
    const out = removeHints(['[[Alpha]]', '[[Games/Alpha|Alpha]]', 'RPG'], i => (i === '[[Alpha]]' ? 'Games/Alpha' : 'Other/Alpha'))
    expect(out).toEqual(['Games/Alpha', 'Other/Alpha', null])
  })
  it('dicas iguais caem no item cru', () => {
    expect(removeHints(['[[Alpha]]', '[[Games/Alpha|Alpha]]', 'RPG'], hintOf))
      .toEqual(['[[Alpha]]', '[[Games/Alpha|Alpha]]', null])
  })
})

describe('isValidNoteName × safePagePath', () => {
  // A regra do nome é mais estrita que a do caminho: todo nome aceito é um caminho seguro.
  it('nome aceito nunca é caminho que o safePagePath recusa', async () => {
    const { safePagePath } = await import('../../lib/pending-page')
    const sample = ['Nova nota', 'Ação 2', 'a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b', 'a\\b',
      'a\u0000b', 'a\u001fb', '.a', 'a.', 'a b', 'x'.repeat(255), '_comments', 'a/b', '..']
    for (const s of sample) if (isValidNoteName(s)) expect(safePagePath(s)).toBe(true)
  })
})
