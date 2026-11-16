import { describe, it, expect } from 'vitest'
import { normalizeForSearch, searchTokens, matchesSearch } from '@/lib/gallery-search'

const frase = normalizeForSearch('Império de Ksarshantallas, Casa Kósmos')

describe('normalizeForSearch', () => {
  it('tira acentos e passa para minúsculas', () => {
    expect(normalizeForSearch('Facções Dracônico KÓSMOS')).toBe('faccoes draconico kosmos')
  })
})

describe('searchTokens', () => {
  it('quebra em espaço e descarta vazios', () => {
    expect(searchTokens('  Ksar   Casa ')).toEqual(['ksar', 'casa'])
  })
  it('vazio ou só espaço dá []', () => {
    expect(searchTokens('')).toEqual([])
    expect(searchTokens('   ')).toEqual([])
  })
})

describe('matchesSearch', () => {
  it('todas as palavras, fora de ordem e sem acento', () => {
    expect(matchesSearch(frase, searchTokens('kosmos ksar'))).toBe(true)
  })
  it('falta uma palavra dá false', () => {
    expect(matchesSearch(frase, searchTokens('casa zzz'))).toBe(false)
  })
  it('tokens vazios dá true', () => {
    expect(matchesSearch('qualquer', [])).toBe(true)
  })
  it('casa literal, sem regex', () => {
    const h = normalizeForSearch("The Inn [Ch.2 v1.02] Ren'Py")
    expect(matchesSearch(h, searchTokens("[ch.2 ren'py"))).toBe(true)
    expect(matchesSearch(h, searchTokens('('))).toBe(false)
    expect(matchesSearch(h, searchTokens('*'))).toBe(false)
  })
})
