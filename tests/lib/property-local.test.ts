import { describe, expect, it } from 'vitest'
import type { PageProperty, PropertyValue } from '@/builder/types'
import {
  localWins,
  mergeProperties,
  NO_LOCAL_PROPERTIES,
  pruneLocalProperties,
  staleValues,
  withLocal,
  type LocalProperty,
  type LocalProperties,
} from '@/lib/property-local'

const r = (key: string, value: PropertyValue): PageProperty => ({ key, type: 'text', value, html: String(value) })
const entry = (value: PropertyValue, stale: PropertyValue[], saving = false): LocalProperty => ({
  row: r('status', value),
  stale,
  saving,
})
const map = (e: LocalProperty): LocalProperties => new Map([['status', e]])

describe('mergeProperties', () => {
  it('a local vence enquanto o servidor mostra um valor de stale', () => {
    const out = mergeProperties([r('status', 'v0')], map(entry('v1', ['v0'])))
    expect(out[0].value).toBe('v1')
  })

  it('o servidor vence quando já tem o valor novo', () => {
    const server = [r('status', 'v1')]
    expect(mergeProperties(server, map(entry('v1', ['v0'])))[0]).toBe(server[0])
  })

  it('o servidor vence com um terceiro valor (outra pessoa)', () => {
    const out = mergeProperties([r('status', 'v9')], map(entry('v1', ['v0'])))
    expect(out[0].value).toBe('v9')
  })

  it('com saving, a local vence mesmo com um terceiro valor', () => {
    const out = mergeProperties([r('status', 'v9')], map(entry('v1', ['v0'], true)))
    expect(out[0].value).toBe('v1')
  })

  it('mantém a ordem do servidor e ignora chave sem linha no servidor', () => {
    const out = mergeProperties(
      [r('a', 1), r('status', 'v0'), r('b', 2)],
      new Map([
        ['status', entry('v1', ['v0'])],
        ['fantasma', { row: r('fantasma', 'x'), stale: [], saving: true }],
      ]),
    )
    expect(out.map(p => p.key)).toEqual(['a', 'status', 'b'])
    expect(out[1].value).toBe('v1')
  })

  it('sem local devolve o próprio array do servidor', () => {
    const server = [r('a', 1)]
    expect(mergeProperties(server, NO_LOCAL_PROPERTIES)).toBe(server)
  })

  it('chave constructor sem entrada não acha nada', () => {
    const server = [r('constructor', 'x'), r('__proto__', 'y')]
    expect(mergeProperties(server, NO_LOCAL_PROPERTIES)).toEqual(server)
    expect(mergeProperties(server, new Map([['status', entry('v1', ['v0'])]]))).toEqual(server)
  })
})

describe('localWins', () => {
  it('falso quando o servidor já tem o valor, mesmo com saving', () => {
    expect(localWins(entry('v1', [], true), r('status', 'v1'))).toBe(false)
  })
})

describe('pruneLocalProperties', () => {
  it('tira a entrada que o servidor alcançou', () => {
    const out = pruneLocalProperties([r('status', 'v1')], map(entry('v1', ['v0'])))
    expect(out.size).toBe(0)
  })

  it('tira a que perde para um terceiro valor', () => {
    expect(pruneLocalProperties([r('status', 'v9')], map(entry('v1', ['v0']))).size).toBe(0)
  })

  it('tira a entrada cuja chave sumiu do servidor', () => {
    expect(pruneLocalProperties([r('outra', 1)], map(entry('v1', ['v0']))).size).toBe(0)
  })

  it('mantém a que tem saving', () => {
    const local = map(entry('v1', [], true))
    expect(pruneLocalProperties([r('outra', 1)], local)).toBe(local)
    expect(pruneLocalProperties([r('status', 'v9')], local)).toBe(local)
  })

  it('devolve o mesmo objeto quando nada muda', () => {
    const local = map(entry('v1', ['v0']))
    expect(pruneLocalProperties([r('status', 'v0')], local)).toBe(local)
    expect(pruneLocalProperties([r('status', 'v0')], NO_LOCAL_PROPERTIES)).toBe(NO_LOCAL_PROPERTIES)
  })
})

describe('edições em cadeia', () => {
  it('um build intermediário com v1 não faz v1 aparecer: mostra v2', () => {
    // v0 -> v1 -> v2; o stale acumulou v0 e v1.
    const first = entry('v1', staleValues(undefined, r('status', 'v0'), r('status', 'v0')))
    const stale = staleValues(first, r('status', 'v0'), r('status', 'v1'))
    expect(stale).toEqual(['v0', 'v1'])
    const local = map(entry('v2', stale))
    const out = mergeProperties([r('status', 'v1')], local)
    expect(out[0].value).toBe('v2')
    expect(pruneLocalProperties([r('status', 'v1')], local)).toBe(local)
  })
})

describe('staleValues', () => {
  it('junta o anterior, o do servidor e o mostrado, sem repetir', () => {
    const prev = entry('v1', ['v0'])
    expect(staleValues(prev, r('status', 'v0'), r('status', 'v1'))).toEqual(['v0', 'v1'])
    expect(staleValues(undefined, undefined, r('status', 'v0'))).toEqual(['v0'])
  })
})

describe('withLocal', () => {
  it('devolve um Map novo com set e delete, sem tocar o original', () => {
    const a = withLocal(NO_LOCAL_PROPERTIES, 'constructor', entry('x', []))
    expect(a).not.toBe(NO_LOCAL_PROPERTIES)
    expect(a.has('constructor')).toBe(true)
    expect(NO_LOCAL_PROPERTIES.size).toBe(0)
    const b = withLocal(a, 'constructor', undefined)
    expect(b.size).toBe(0)
    expect(a.size).toBe(1)
  })
})
