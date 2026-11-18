import { describe, it, expect } from 'vitest'
import { LinkResolver } from '../../builder/link-resolver'
import { collectPropertyRelations, relationCandidates } from '../../builder/property-relations'
import { EMPTY_PROPERTY_CONFIG, type PropertyConfig } from '../../builder/property-types'
import type { PageProperty } from '../../builder/types'

type Note = { path: string; title: string }

const note = (p: string): Note => ({ path: p, title: p.split('/').pop() as string })
const resolverFor = (notes: Note[]) =>
  new LinkResolver(notes.map(n => ({ absolutePath: `/v/${n.path}.md`, relativePath: n.path, title: n.title })))

function setup(paths: string[]) {
  const notes = paths.map(note)
  const warns: string[] = []
  return { notes, resolver: resolverFor(notes), warns, warn: (m: string) => warns.push(m) }
}

const config = (relation: Record<string, string>): PropertyConfig => ({
  ...EMPTY_PROPERTY_CONFIG,
  relation: new Map(Object.entries(relation)),
})

const row = (key: string, value: string[], extra: Partial<PageProperty> = {}): PageProperty => ({
  key, type: 'multitext', value, html: '', relation: true, ...extra,
})

describe('relationCandidates', () => {
  it('lista as notas da pasta, subpastas incluídas, e deixa as de fora', () => {
    const { notes, resolver, warns, warn } = setup(['Games/Alpha', 'Games/Sub/Beta', 'Other/Gamma'])
    expect(relationCandidates(notes, 'Games', resolver, warn)).toEqual([
      { link: '[[Alpha]]', label: 'Alpha', path: 'Games/Alpha' },
      { link: '[[Beta]]', label: 'Beta', path: 'Games/Sub/Beta' },
    ])
    expect(warns).toEqual([])
  })

  it('ignora a caixa da pasta', () => {
    const { notes, resolver, warn } = setup(['Games/Alpha', 'Games/Sub/Beta', 'Other/Gamma'])
    expect(relationCandidates(notes, 'games', resolver, warn).map(c => c.path)).toEqual(['Games/Alpha', 'Games/Sub/Beta'])
  })

  it('título ambíguo que o resolver leva a outra nota: usa o caminho', () => {
    const { notes, resolver, warn } = setup(['Shallow', 'Notes/Delta', 'Games/Sub/Delta'])
    expect(relationCandidates(notes, 'Games', resolver, warn)).toEqual([
      { link: '[[Games/Sub/Delta]]', label: 'Games/Sub/Delta', path: 'Games/Sub/Delta' },
    ])
  })

  it('nota de mesmo nome na raiz: usa o caminho', () => {
    const { notes, resolver, warn } = setup(['Epsilon', 'Games/Epsilon'])
    expect(relationCandidates(notes, 'Games', resolver, warn).map(c => c.link)).toEqual(['[[Games/Epsilon]]'])
  })

  it('nota que nenhum link alcança sai, com aviso', () => {
    const { notes, resolver, warns, warn } = setup(['Games/A#B', 'Games/Ok'])
    expect(relationCandidates(notes, 'Games', resolver, warn).map(c => c.path)).toEqual(['Games/Ok'])
    expect(warns).toEqual(['.vaultwright/properties.json: nenhum link leva à nota "Games/A#B"; fora da relation'])
  })

  it('ordena em pt-BR', () => {
    const { notes, resolver, warn } = setup(['Games/Zeta', 'Games/ábaco', 'Games/Abelha'])
    expect(relationCandidates(notes, 'Games', resolver, warn).map(c => c.label)).toEqual(['ábaco', 'Abelha', 'Zeta'])
  })
})

describe('collectPropertyRelations', () => {
  const paths = ['Games/Alpha', 'Games/Sub/Beta', 'Other/Gamma']

  it('uma entrada por chave de relação, com os itens que levam a um candidato', () => {
    const { notes, resolver, warn } = setup(paths)
    const items = ['[[alpha]]', '[[Games/Alpha|Apelido]]', '[[Alpha#Seção]]', '[[Gamma]]', '[[Dead]]', 'Alpha', '__proto__']
    const out = collectPropertyRelations([{ properties: [row('related', items)] }], notes, config({ related: 'Games' }), resolver, warn)
    expect(Object.keys(out)).toEqual(['related'])
    expect(out.related.candidates.map(c => c.path)).toEqual(['Games/Alpha', 'Games/Sub/Beta'])
    expect(out.related.resolved).toStrictEqual({
      '[[alpha]]': 'Games/Alpha',
      '[[Games/Alpha|Apelido]]': 'Games/Alpha',
      '[[Alpha#Seção]]': 'Games/Alpha',
    })
  })

  it('linha travada ou sem relation não cria entrada', () => {
    const { notes, resolver, warn } = setup(paths)
    const pages = [{ properties: [row('a', [], { locked: 'readonly' }), row('b', ['x'], { relation: undefined })] }]
    expect(collectPropertyRelations(pages, notes, config({ a: 'Games', b: 'Games' }), resolver, warn)).toStrictEqual({})
  })

  it('entrada mesmo sem itens, e __proto__ como chave comum', () => {
    const { notes, resolver, warn } = setup(paths)
    const out = collectPropertyRelations([{ properties: [row('__proto__', [])] }], notes, config(Object.fromEntries([['__proto__', 'Games']])), resolver, warn)
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    expect(out['__proto__'].resolved).toStrictEqual({})
  })

  it('pasta sem nota avisa, mesmo sem uso', () => {
    const { notes, resolver, warns, warn } = setup(paths)
    collectPropertyRelations([], notes, config({ rel2: 'Missing' }), resolver, warn)
    expect(warns).toEqual(['.vaultwright/properties.json: "rel2": nenhuma nota na pasta "Missing"'])
  })
})
