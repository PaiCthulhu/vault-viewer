import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  EMPTY_PROPERTY_CONFIG,
  inferPropertyType,
  inferValueType,
  isNestedObject,
  isReadonlyProperty,
  loadPropertyConfig,
  lookupPropertyType,
  normalizePropertyValue,
  parseObsidianTypes,
  parseVaultwrightProperties,
  resolvePropertyType,
  toJsonSafe,
  type PropertyConfig,
} from '../../builder/property-types'

const d = (y: number, m: number, day: number, h = 0, mi = 0, s = 0) =>
  new Date(Date.UTC(y, m - 1, day, h, mi, s))

const tmpDirs: string[] = []
function tmpVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptypes-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseObsidianTypes', () => {
  it('lê tipos válidos e ignora desconhecidos', () => {
    const m = parseObsidianTypes('{"types":{"rating":"number","genres":"multitext","foo":"weird"}}')!
    expect(m.get('rating')).toBe('number')
    expect(m.get('genres')).toBe('multitext')
    expect(m.has('foo')).toBe(false)
  })
  it('aceita BOM', () => {
    const m = parseObsidianTypes('\uFEFF{"types":{"rating":"number"}}')!
    expect(m.get('rating')).toBe('number')
  })
  it('JSON inválido ou formato errado dá null', () => {
    expect(parseObsidianTypes('{')).toBeNull()
    expect(parseObsidianTypes('[]')).toBeNull()
    expect(parseObsidianTypes('{"types":[]}')).toBeNull()
    expect(parseObsidianTypes('{}')).toBeNull()
  })
  it('chave constructor é uma chave comum; config vazio não herda do protótipo', () => {
    const cfg: PropertyConfig = {
      types: parseObsidianTypes('{"types":{"constructor":"number"}}')!,
      readonly: new Set(),
    }
    expect(lookupPropertyType(cfg, 'constructor')).toBe('number')
    expect(lookupPropertyType(EMPTY_PROPERTY_CONFIG, 'toString')).toBeUndefined()
  })
})

describe('parseVaultwrightProperties', () => {
  it('devolve só as chaves com readonly true', () => {
    const s = parseVaultwrightProperties(
      '{"version":1,"properties":{"status":{"readonly":true},"rating":{"readonly":false}}}',
    )!
    expect([...s]).toEqual(['status'])
  })
  it('outra versão ou formato errado dá null', () => {
    expect(parseVaultwrightProperties('{"version":2,"properties":{}}')).toBeNull()
    expect(parseVaultwrightProperties('{"version":1}')).toBeNull()
    expect(parseVaultwrightProperties('nope')).toBeNull()
    expect(parseVaultwrightProperties('[]')).toBeNull()
  })
  it('chaves com nome de Object.prototype são chaves comuns', () => {
    const s = parseVaultwrightProperties(
      '{"version":1,"properties":{"__proto__":{"readonly":true},"constructor":{"readonly":true}}}',
    )!
    expect([...s].sort()).toEqual(['__proto__', 'constructor'])
    const plain = parseVaultwrightProperties('{"version":1,"properties":{"status":{"readonly":true}}}')!
    const cfg: PropertyConfig = { types: new Map(), readonly: plain }
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isReadonlyProperty(cfg, k)).toBe(false)
    }
  })
  it('aceita BOM', () => {
    const s = parseVaultwrightProperties('\uFEFF{"version":1,"properties":{"a":{"readonly":true}}}')!
    expect(s.has('a')).toBe(true)
  })
  it('isReadonlyProperty ignora a caixa', () => {
    const cfg: PropertyConfig = { types: new Map(), readonly: new Set(['status']) }
    expect(isReadonlyProperty(cfg, 'Status')).toBe(true)
    expect(isReadonlyProperty(cfg, 'other')).toBe(false)
  })
})

describe('loadPropertyConfig', () => {
  it('sem os arquivos: vazio e sem warn', () => {
    const warn = vi.fn()
    const cfg = loadPropertyConfig(tmpVault(), warn)
    expect(cfg.types.size).toBe(0)
    expect(cfg.readonly.size).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })
  it('types.json inválido avisa uma vez e o .vaultwright válido carrega', () => {
    const v = tmpVault()
    fs.mkdirSync(path.join(v, '.obsidian'))
    fs.mkdirSync(path.join(v, '.vaultwright'))
    fs.writeFileSync(path.join(v, '.obsidian', 'types.json'), '{')
    fs.writeFileSync(
      path.join(v, '.vaultwright', 'properties.json'),
      '{"version":1,"properties":{"status":{"readonly":true}}}',
    )
    const warn = vi.fn()
    const cfg = loadPropertyConfig(v, warn)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('.obsidian/types.json')
    expect(cfg.readonly.has('status')).toBe(true)
    expect(cfg.types.size).toBe(0)
  })
  it('carrega os dois arquivos válidos', () => {
    const v = tmpVault()
    fs.mkdirSync(path.join(v, '.obsidian'))
    fs.writeFileSync(path.join(v, '.obsidian', 'types.json'), '{"types":{"rating":"number"}}')
    const cfg = loadPropertyConfig(v, vi.fn())
    expect(cfg.types.get('rating')).toBe('number')
  })
  it('types.json que é pasta: avisa e não lança', () => {
    const v = tmpVault()
    fs.mkdirSync(path.join(v, '.obsidian', 'types.json'), { recursive: true })
    const warn = vi.fn()
    expect(() => loadPropertyConfig(v, warn)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('.obsidian/types.json')
  })
  it('warn padrão é console.warn', () => {
    const v = tmpVault()
    fs.mkdirSync(path.join(v, '.vaultwright'))
    fs.writeFileSync(path.join(v, '.vaultwright', 'properties.json'), '{')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    loadPropertyConfig(v)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('.vaultwright/properties.json')
    spy.mockRestore()
  })
})

describe('busca de chave', () => {
  it('exata primeiro, depois a primeira sem caixa', () => {
    const cfg: PropertyConfig = {
      types: parseObsidianTypes('{"types":{"Rating":"number","rating":"text"}}')!,
      readonly: new Set(),
    }
    expect(lookupPropertyType(cfg, 'rating')).toBe('text')
    expect(lookupPropertyType(cfg, 'RATING')).toBe('number')
    expect(lookupPropertyType(cfg, 'nada')).toBeUndefined()
  })
})

describe('inferência', () => {
  it('escalares e listas', () => {
    expect(inferValueType(true)).toBe('checkbox')
    expect(inferValueType(3.5)).toBe('number')
    expect(inferValueType(NaN)).toBe('text')
    expect(inferValueType(Infinity)).toBe('text')
    expect(inferValueType(['a'])).toBe('multitext')
    expect(inferValueType(null)).toBe('text')
    expect(inferValueType({ a: 1 })).toBe('text')
  })
  it('datas', () => {
    expect(inferValueType(d(2024, 1, 12))).toBe('date')
    expect(inferValueType(d(2024, 1, 12, 10, 5))).toBe('datetime')
    expect(inferValueType(new Date(NaN))).toBe('text')
    expect(inferValueType('2024-01-12')).toBe('date')
    expect(inferValueType(' 2024-01-12 ')).toBe('date')
    expect(inferValueType('2024-01-12T10:05')).toBe('datetime')
    expect(inferValueType('2024-01-12 10:05:30')).toBe('datetime')
    expect(inferValueType('2024-02-30')).toBe('text')
    expect(inferValueType('2024-01-12T25:00')).toBe('text')
    expect(inferValueType('12/01/2024')).toBe('text')
  })
  it('chave tags/aliases em qualquer caixa', () => {
    expect(inferPropertyType('Tags', 'x')).toBe('tags')
    expect(inferPropertyType('aliases', null)).toBe('aliases')
    expect(inferPropertyType('ALIASES', [])).toBe('aliases')
    expect(inferPropertyType('other', 3)).toBe('number')
  })
  it('resolvePropertyType prefere a config', () => {
    const cfg: PropertyConfig = { types: new Map([['rating', 'text']]), readonly: new Set() }
    expect(resolvePropertyType('rating', 3, cfg)).toBe('text')
    expect(resolvePropertyType('other', 3, cfg)).toBe('number')
    expect(resolvePropertyType('tags', 'x', cfg)).toBe('tags')
  })
})

describe('normalizePropertyValue', () => {
  it('text', () => {
    expect(normalizePropertyValue('text', 12)).toEqual({ value: '12', mismatch: false })
    expect(normalizePropertyValue('text', true)).toEqual({ value: 'true', mismatch: false })
    expect(normalizePropertyValue('text', d(2024, 1, 12))).toEqual({ value: '2024-01-12', mismatch: false })
    expect(normalizePropertyValue('text', d(2024, 1, 12, 10, 5))).toEqual({
      value: '2024-01-12T10:05',
      mismatch: false,
    })
    expect(normalizePropertyValue('text', '  x ')).toEqual({ value: '  x ', mismatch: false })
    expect(normalizePropertyValue('text', '   ')).toEqual({ value: null, mismatch: false })
    expect(normalizePropertyValue('text', ['a'])).toEqual({ value: ['a'], mismatch: true })
  })
  it('number', () => {
    expect(normalizePropertyValue('number', '12')).toEqual({ value: '12', mismatch: true })
    expect(normalizePropertyValue('number', null)).toEqual({ value: null, mismatch: false })
    expect(normalizePropertyValue('number', 4)).toEqual({ value: 4, mismatch: false })
    expect(normalizePropertyValue('number', NaN).mismatch).toBe(true)
  })
  it('checkbox', () => {
    expect(normalizePropertyValue('checkbox', 'true').mismatch).toBe(true)
    expect(normalizePropertyValue('checkbox', false)).toEqual({ value: false, mismatch: false })
    expect(normalizePropertyValue('checkbox', undefined)).toEqual({ value: null, mismatch: false })
  })
  it('date', () => {
    expect(normalizePropertyValue('date', '2024-01-12T10:00')).toEqual({
      value: '2024-01-12T10:00',
      mismatch: true,
    })
    expect(normalizePropertyValue('date', d(2024, 1, 12))).toEqual({ value: '2024-01-12', mismatch: false })
    expect(normalizePropertyValue('date', '2024-01-12')).toEqual({ value: '2024-01-12', mismatch: false })
    expect(normalizePropertyValue('date', '2024-02-30').mismatch).toBe(true)
    expect(normalizePropertyValue('date', d(2024, 1, 12, 1)).mismatch).toBe(true)
  })
  it('datetime', () => {
    expect(normalizePropertyValue('datetime', '2024-01-12 10:00:59')).toEqual({
      value: '2024-01-12T10:00',
      mismatch: false,
    })
    expect(normalizePropertyValue('datetime', '2024-01-12')).toEqual({
      value: '2024-01-12T00:00',
      mismatch: false,
    })
    expect(normalizePropertyValue('datetime', d(2024, 1, 12, 23, 27, 41))).toEqual({
      value: '2024-01-12T23:27',
      mismatch: false,
    })
    expect(normalizePropertyValue('datetime', 5).mismatch).toBe(true)
  })
  it('listas', () => {
    expect(normalizePropertyValue('multitext', [' a ', null, '', 3, false])).toEqual({
      value: ['a', '3', 'false'],
      mismatch: false,
    })
    expect(normalizePropertyValue('multitext', [])).toEqual({ value: [], mismatch: false })
    expect(normalizePropertyValue('tags', null)).toEqual({ value: [], mismatch: false })
    expect(normalizePropertyValue('tags', 'foo')).toEqual({ value: 'foo', mismatch: true })
    expect(normalizePropertyValue('multitext', [d(2024, 1, 12)])).toEqual({
      value: ['2024-01-12'],
      mismatch: false,
    })
    expect(normalizePropertyValue('aliases', '  ')).toEqual({ value: [], mismatch: false })
  })
  it('o tipo inferido nunca dá mismatch', () => {
    const samples: unknown[] = [
      true, false, 0, 3.5, -1, NaN, Infinity, 'abc', 'a b', '2024-01-12', '2024-01-12T10:05',
      '2024-01-12 10:05', '2024-01-12 10:05:30', '2024-02-30', '2024-13-01', d(2024, 1, 12),
      d(2024, 1, 12, 10, 5), d(2024, 1, 12, 0, 0, 30), new Date(NaN), null, undefined, '', '   ',
      [], ['a', 'b'], [1, 2], [d(2024, 1, 12)], ['a', null, ''], [new Date(NaN)],
    ]
    for (const v of samples) {
      expect(normalizePropertyValue(inferValueType(v), v).mismatch, String(v)).toBe(false)
    }
  })
  it('fallback do mismatch para objeto aninhado', () => {
    expect(normalizePropertyValue('text', { a: 1 })).toEqual({ value: { a: 1 }, mismatch: true })
    expect(normalizePropertyValue('multitext', ['a', { b: 1 }])).toEqual({
      value: ['a', { b: 1 }],
      mismatch: true,
    })
  })
  it('Date inválida em lista sai como vazio', () => {
    expect(normalizePropertyValue('multitext', [new Date(NaN)])).toEqual({ value: [], mismatch: false })
  })
  it('com mismatch, o valor é o do tipo inferido', () => {
    const r = normalizePropertyValue('number', d(2024, 1, 12))
    expect(r).toEqual({ value: normalizePropertyValue(inferValueType(d(2024, 1, 12)), d(2024, 1, 12)).value, mismatch: true })
  })
})

describe('objetos', () => {
  it('isNestedObject', () => {
    expect(isNestedObject({ a: 1 })).toBe(true)
    expect(isNestedObject([1, { a: 1 }])).toBe(true)
    expect(isNestedObject([[1]])).toBe(true)
    expect(isNestedObject(['a'])).toBe(false)
    expect(isNestedObject(new Date())).toBe(false)
    expect(isNestedObject(null)).toBe(false)
    expect(isNestedObject('x')).toBe(false)
  })
  it('toJsonSafe', () => {
    expect(toJsonSafe({ d: d(2024, 1, 12), n: NaN, u: undefined })).toEqual({
      d: '2024-01-12T00:00:00.000Z',
      n: 'NaN',
      u: null,
    })
    expect(toJsonSafe(new Date(NaN))).toBeNull()
    expect(toJsonSafe([1, [new Date(NaN)]])).toEqual([1, [null]])
  })
  it('toJsonSafe não mexe no protótipo', () => {
    const r = toJsonSafe(JSON.parse('{"__proto__":{"x":1}}')) as object
    expect(Object.hasOwn(r, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})
