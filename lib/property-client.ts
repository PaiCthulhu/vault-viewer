// Chamadas do navegador à API de propriedades (`/api/vault/<slug>/properties` e
// `/property-values`). Cada uma devolve o resultado ou a chave i18n de um erro curto.
// Só tipos de `builder/`: os módulos de valor de lá puxam `node:fs`.
import type { PageProperty, PropertyValue } from '@/builder/types'
import { IMAGE_VALUE_ERROR, TYPE_CHANGE_ERROR } from '@/lib/property-messages'

const REQUEST_TIMEOUT_MS = 30_000
const VALUES_TIMEOUT_MS = 10_000

export interface PropertyPatch {
  path: string
  key: string
  value: PropertyValue
  expected: PropertyValue
  confirm?: boolean
}
export type PropertyFailure = {
  ok: false
  status: number // 0 = rede, tempo esgotado; 401 também cobre o redirecionamento para o login
  errorKey: string
  // No 409: a linha como está no disco.
  property?: PageProperty
}
export type PropertyResult = { ok: true; property: PageProperty } | PropertyFailure

const KEY_PREFIX = 'properties.error.'

// Toda chave que `propertyErrorKey` e `textDraftValue` (lib/property-edit.ts) podem devolver.
export const PROPERTY_ERROR_KEYS: readonly string[] = [
  'network', 'session', 'forbidden', 'gone', 'conflict', 'clearChangesType', 'valueChangesType',
  'image', 'invalid', 'number', 'date', 'tooLong', 'unsupported', 'unavailable', 'generic',
].map((k) => KEY_PREFIX + k)

export function propertyErrorKey(status: number, error: string | null, sentNull: boolean): string {
  switch (status) {
    case 0: return KEY_PREFIX + 'network'
    case 401: return KEY_PREFIX + 'session'
    case 403: return KEY_PREFIX + 'forbidden'
    case 404: return KEY_PREFIX + 'gone'
    case 409: return KEY_PREFIX + 'conflict'
    case 422: return KEY_PREFIX + 'unsupported'
    case 503: return KEY_PREFIX + 'unavailable'
    case 400:
      if (error === TYPE_CHANGE_ERROR) return KEY_PREFIX + (sentNull ? 'clearChangesType' : 'valueChangesType')
      if (error === IMAGE_VALUE_ERROR) return KEY_PREFIX + 'image'
      return KEY_PREFIX + 'invalid'
    default: return KEY_PREFIX + 'generic'
  }
}

export function isPageProperty(v: unknown): v is PageProperty {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return typeof p.key === 'string' && typeof p.type === 'string' && typeof p.html === 'string' &&
    Object.hasOwn(p, 'value')
}

// Faz o fetch com tempo limite e devolve status e corpo JSON (objeto ou null).
async function request(
  url: string, init: RequestInit, timeoutMs: number,
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  // AbortController + setTimeout (e não AbortSignal.timeout) para o relógio falso dos testes valer.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      // Sem cookie de sessão o proxy redireciona para o login: sem isto o fetch seguiria
      // o redirecionamento e leria a página de login como se fosse a resposta.
      redirect: 'manual',
      signal: ctrl.signal,
    })
    if (res.type === 'opaqueredirect') return { status: 401, data: null }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    const obj = typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null
    return { status: res.status, data: obj }
  } catch {
    return { status: 0, data: null }
  } finally {
    clearTimeout(timer)
  }
}

export async function patchProperty(slug: string, patch: PropertyPatch): Promise<PropertyResult> {
  const payload: Record<string, unknown> = {
    path: patch.path, key: patch.key, value: patch.value, expected: patch.expected,
  }
  if (patch.confirm === true) payload.confirm = true
  const { status, data } = await request('/api/vault/' + encodeURIComponent(slug) + '/properties', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, REQUEST_TIMEOUT_MS)

  if (status === 200) {
    if (data && isPageProperty(data.property)) return { ok: true, property: data.property }
    return { ok: false, status, errorKey: KEY_PREFIX + 'generic' }
  }
  const error = data && typeof data.error === 'string' ? data.error : null
  const fail: PropertyFailure = {
    ok: false, status, errorKey: propertyErrorKey(status, error, patch.value === null),
  }
  if (status === 409 && data && isPageProperty(data.property)) fail.property = data.property
  return fail
}

// Valores já usados numa propriedade de lista, para sugerir. `null` em qualquer falha.
export async function fetchPropertyValues(slug: string, key: string): Promise<string[] | null> {
  const { status, data } = await request(
    '/api/vault/' + encodeURIComponent(slug) + '/property-values?key=' + encodeURIComponent(key),
    {}, VALUES_TIMEOUT_MS,
  )
  if (status !== 200 || !data || !Array.isArray(data.values)) return null
  return data.values.filter((v): v is string => typeof v === 'string')
}
