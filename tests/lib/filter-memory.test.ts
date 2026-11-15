import { describe, it, expect } from 'vitest'
import { chipsToRestore, type FilterMemory } from '@/lib/filter-memory'

const offered = new Map([
  ['Engine', ["Ren'Py", 'Unity']],
  ['Status', ['Jogando', 'Zerado']],
])
const mem = (chips: FilterMemory['chips'], path = 'Views/X'): FilterMemory => ({ path, chips })

describe('chipsToRestore', () => {
  it('memória nula dá []', () => {
    expect(chipsToRestore(null, 'Views/X', offered)).toEqual([])
  })
  it('outra página dá []', () => {
    expect(chipsToRestore(mem([{ key: 'Engine', value: 'Unity' }]), 'Views/Y', offered)).toEqual([])
  })
  it('mesma página devolve os chips na ordem', () => {
    const chips = [{ key: 'Engine', value: "Ren'Py" }, { key: 'Status', value: 'Jogando' }]
    expect(chipsToRestore(mem(chips), 'Views/X', offered)).toEqual(chips)
  })
  it('propriedade que sumiu é pulada', () => {
    const chips = [{ key: 'Gone', value: 'a' }, { key: 'Status', value: 'Jogando' }]
    expect(chipsToRestore(mem(chips), 'Views/X', offered)).toEqual([{ key: 'Status', value: 'Jogando' }])
  })
  it('valor que sumiu vira vazio', () => {
    expect(chipsToRestore(mem([{ key: 'Engine', value: 'Godot' }]), 'Views/X', offered)).toEqual([
      { key: 'Engine', value: '' },
    ])
  })
  it("chip com '' continua ''", () => {
    expect(chipsToRestore(mem([{ key: 'Engine', value: '' }]), 'Views/X', offered)).toEqual([
      { key: 'Engine', value: '' },
    ])
  })
})
