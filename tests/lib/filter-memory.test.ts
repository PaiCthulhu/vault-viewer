import { describe, it, expect } from 'vitest'
import { chipsToRestore, queryToRestore, type FilterMemory } from '@/lib/filter-memory'

const offered = new Map([
  ['Motor', ["Alfa'X", 'Gama']],
  ['Etapa', ['Fase Um', 'Fase Dois']],
])
const mem = (chips: FilterMemory['chips'], path = 'Pasta/X'): FilterMemory => ({ path, chips })

describe('chipsToRestore', () => {
  it('memória nula dá []', () => {
    expect(chipsToRestore(null, 'Pasta/X', offered)).toEqual([])
  })
  it('outra página dá []', () => {
    expect(chipsToRestore(mem([{ key: 'Motor', value: 'Gama' }]), 'Pasta/Y', offered)).toEqual([])
  })
  it('mesma página devolve os chips na ordem', () => {
    const chips = [{ key: 'Motor', value: "Alfa'X" }, { key: 'Etapa', value: 'Fase Um' }]
    expect(chipsToRestore(mem(chips), 'Pasta/X', offered)).toEqual(chips)
  })
  it('propriedade que sumiu é pulada', () => {
    const chips = [{ key: 'Gone', value: 'a' }, { key: 'Etapa', value: 'Fase Um' }]
    expect(chipsToRestore(mem(chips), 'Pasta/X', offered)).toEqual([{ key: 'Etapa', value: 'Fase Um' }])
  })
  it('valor que sumiu vira vazio', () => {
    expect(chipsToRestore(mem([{ key: 'Motor', value: 'Ômega' }]), 'Pasta/X', offered)).toEqual([
      { key: 'Motor', value: '' },
    ])
  })
  it("chip com '' continua ''", () => {
    expect(chipsToRestore(mem([{ key: 'Motor', value: '' }]), 'Pasta/X', offered)).toEqual([
      { key: 'Motor', value: '' },
    ])
  })
})

describe('queryToRestore', () => {
  it('memória nula dá vazio', () => {
    expect(queryToRestore(null, 'Pasta/X')).toBe('')
  })
  it('mesma página devolve o texto; outra dá vazio', () => {
    const m: FilterMemory = { path: 'Pasta/X', chips: [], query: 'exemp' }
    expect(queryToRestore(m, 'Pasta/X')).toBe('exemp')
    expect(queryToRestore(m, 'Pasta/Y')).toBe('')
  })
  it('memória sem query dá vazio', () => {
    expect(queryToRestore({ path: 'Pasta/X', chips: [] }, 'Pasta/X')).toBe('')
  })
})
