import { describe, it, expect, vi, afterEach } from 'vitest'
import type { PageProperty } from '../../builder/types'
import {
  fetchPropertyOptions, fetchPropertyValues, isPageProperty, patchProperty, propertyErrorKey, PROPERTY_ERROR_KEYS,
} from '../../lib/property-client'
import { IMAGE_VALUE_ERROR, TYPE_CHANGE_ERROR } from '../../lib/property-messages'
import { en } from '../../lib/i18n/en'
import { ptBR } from '../../lib/i18n/pt-BR'

const ROW: PageProperty = { key: 'status', type: 'text', value: 'ok', html: 'ok' }

function mockFetch(status: number, body: unknown, extra: Partial<Response> = {}) {
  const fn = vi.fn(async () => ({
    status, type: 'basic', json: async () => body, ...extra,
  }) as unknown as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('patchProperty', () => {
  it('manda PATCH em JSON, sem confirm quando é false ou ausente', async () => {
    const fn = mockFetch(200, { property: ROW })
    const res = await patchProperty('my vault', { path: 'Notes/My Note', key: 'status', value: 'ok', expected: 'x' })
    expect(res).toEqual({ ok: true, property: ROW })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/vault/my%20vault/properties')
    expect(init.method).toBe('PATCH')
    expect(init.redirect).toBe('manual')
    expect(init.cache).toBe('no-store')
    expect(JSON.parse(init.body as string)).toEqual({ path: 'Notes/My Note', key: 'status', value: 'ok', expected: 'x' })
    await patchProperty('v', { path: 'a', key: 'k', value: null, expected: null, confirm: false })
    const init2 = (fn.mock.calls[1] as unknown as [string, RequestInit])[1]
    expect(Object.hasOwn(JSON.parse(init2.body as string), 'confirm')).toBe(false)
  })

  it('manda confirm: true quando é true', async () => {
    const fn = mockFetch(200, { property: ROW })
    await patchProperty('v', { path: 'a', key: 'k', value: 1, expected: 2, confirm: true })
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).confirm).toBe(true)
  })

  it('200 com corpo errado vira generic com status 200', async () => {
    mockFetch(200, { property: { key: 1 } })
    expect(await patchProperty('v', { path: 'a', key: 'k', value: 1, expected: 2 }))
      .toEqual({ ok: false, status: 200, errorKey: 'properties.error.generic' })
  })

  it('redirecionamento opaco conta como 401', async () => {
    mockFetch(0, null, { type: 'opaqueredirect' })
    expect(await patchProperty('v', { path: 'a', key: 'k', value: 1, expected: 2 }))
      .toEqual({ ok: false, status: 401, errorKey: 'properties.error.session' })
  })

  it('fetch que lança dá status 0 e network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x') }))
    expect(await patchProperty('v', { path: 'a', key: 'k', value: 1, expected: 2 }))
      .toEqual({ ok: false, status: 0, errorKey: 'properties.error.network' })
  })

  it('estourar os 30 s aborta e dá status 0', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError')))
    })))
    const p = patchProperty('v', { path: 'a', key: 'k', value: 1, expected: 2 })
    await vi.advanceTimersByTimeAsync(30_000)
    const res = await p
    expect(res.ok).toBe(false)
    expect(!res.ok && res.status).toBe(0)
  })

  it('409 com property leva a linha atual; sem property não leva', async () => {
    mockFetch(409, { error: 'x', property: ROW })
    expect(await patchProperty('v', { path: 'a', key: 'k', value: 1, expected: 2 }))
      .toEqual({ ok: false, status: 409, errorKey: 'properties.error.conflict', property: ROW })
    mockFetch(409, { error: 'x' })
    const res = await patchProperty('v', { path: 'a', key: 'k', value: 1, expected: 2 })
    expect(res).toEqual({ ok: false, status: 409, errorKey: 'properties.error.conflict' })
  })

  it('400 usa a mensagem da API e se o valor mandado era null', async () => {
    mockFetch(400, { error: TYPE_CHANGE_ERROR })
    expect(await patchProperty('v', { path: 'a', key: 'k', value: null, expected: 2 }))
      .toMatchObject({ errorKey: 'properties.error.clearChangesType' })
    expect(await patchProperty('v', { path: 'a', key: 'k', value: 3, expected: 2 }))
      .toMatchObject({ errorKey: 'properties.error.valueChangesType' })
  })
})

describe('propertyErrorKey', () => {
  const k = (x: string) => 'properties.error.' + x
  it('mapeia a tabela inteira', () => {
    expect(propertyErrorKey(0, null, false)).toBe(k('network'))
    expect(propertyErrorKey(401, null, false)).toBe(k('session'))
    expect(propertyErrorKey(403, null, false)).toBe(k('forbidden'))
    expect(propertyErrorKey(404, null, false)).toBe(k('gone'))
    expect(propertyErrorKey(409, null, false)).toBe(k('conflict'))
    expect(propertyErrorKey(400, TYPE_CHANGE_ERROR, true)).toBe(k('clearChangesType'))
    expect(propertyErrorKey(400, TYPE_CHANGE_ERROR, false)).toBe(k('valueChangesType'))
    expect(propertyErrorKey(400, IMAGE_VALUE_ERROR, false)).toBe(k('image'))
    expect(propertyErrorKey(400, 'outra coisa', false)).toBe(k('invalid'))
    expect(propertyErrorKey(400, null, false)).toBe(k('invalid'))
    expect(propertyErrorKey(422, 'x', false)).toBe(k('unsupported'))
    expect(propertyErrorKey(503, null, false)).toBe(k('unavailable'))
    expect(propertyErrorKey(500, null, false)).toBe(k('generic'))
  })
})

describe('isPageProperty', () => {
  it('aceita uma linha válida e recusa o resto', () => {
    expect(isPageProperty(ROW)).toBe(true)
    expect(isPageProperty(null)).toBe(false)
    expect(isPageProperty({ key: 'a', type: 'text' })).toBe(false)
    expect(isPageProperty({ ...ROW, html: 1 })).toBe(false)
  })
})

describe('fetchPropertyValues', () => {
  it('filtra o que não é string e codifica a chave', async () => {
    const fn = mockFetch(200, { values: ['a', 1, null, 'b'] })
    expect(await fetchPropertyValues('my vault', 'a&b')).toEqual(['a', 'b'])
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/vault/my%20vault/property-values?key=a%26b')
    expect(init.redirect).toBe('manual')
    expect(init.cache).toBe('no-store')
  })

  it('403, corpo sem array e redirecionamento dão null', async () => {
    mockFetch(403, { error: 'x' })
    expect(await fetchPropertyValues('v', 'k')).toBeNull()
    mockFetch(200, { values: 'x' })
    expect(await fetchPropertyValues('v', 'k')).toBeNull()
    mockFetch(0, null, { type: 'opaqueredirect' })
    expect(await fetchPropertyValues('v', 'k')).toBeNull()
  })
})

describe('fetchPropertyOptions', () => {
  it('sem relation devolve relation null', async () => {
    mockFetch(200, { values: ['a'] })
    expect(await fetchPropertyOptions('v', 'k')).toEqual({ values: ['a'], relation: null })
  })
  it('com relation filtra candidato malformado e resolved não texto', async () => {
    mockFetch(200, {
      values: [],
      relation: {
        candidates: [{ link: '[[A]]', label: 'A', path: 'G/A' }, { link: '[[B]]', label: 'B' }, null],
        resolved: { '[[a|x]]': 'G/A', '[[b]]': 5 },
      },
    })
    expect(await fetchPropertyOptions('v', 'k')).toEqual({
      values: [],
      relation: { candidates: [{ link: '[[A]]', label: 'A', path: 'G/A' }], resolved: { '[[a|x]]': 'G/A' } },
    })
  })
  it('500 dá null', async () => {
    mockFetch(500, { error: 'x' })
    expect(await fetchPropertyOptions('v', 'k')).toBeNull()
  })
})

describe('dicionários', () => {
  it('toda chave de erro existe em en e em pt-BR', () => {
    for (const key of PROPERTY_ERROR_KEYS) {
      expect(en[key], key).toBeTruthy()
      expect(ptBR[key], key).toBeTruthy()
    }
  })

  it('os textos de mudança de tipo são os combinados', () => {
    expect(en['properties.error.clearChangesType']).toBe("Clearing this value would change the property's type")
    expect(en['properties.error.valueChangesType']).toBe("This value would change the property's type")
    expect(ptBR['properties.error.clearChangesType']).toBe('Limpar mudaria o tipo da propriedade')
    expect(ptBR['properties.error.valueChangesType']).toBe('Esse valor mudaria o tipo da propriedade')
  })
})
