import { describe, it, expect } from 'vitest'
import { normalizeForSearch, searchTokens, matchesSearch } from '@/lib/gallery-search'

const frase = normalizeForSearch('Liga de Exemplópolis, Casa Órbita')

describe('normalizeForSearch', () => {
  it('tira acentos e passa para minúsculas', () => {
    expect(normalizeForSearch('Seleções Atômico ÓRBITA')).toBe('selecoes atomico orbita')
  })
})

describe('searchTokens', () => {
  it('quebra em espaço e descarta vazios', () => {
    expect(searchTokens('  Exemp   Casa ')).toEqual(['exemp', 'casa'])
  })
  it('vazio ou só espaço dá []', () => {
    expect(searchTokens('')).toEqual([])
    expect(searchTokens('   ')).toEqual([])
  })
})

describe('matchesSearch', () => {
  it('todas as palavras, fora de ordem e sem acento', () => {
    expect(matchesSearch(frase, searchTokens('orbita exemp'))).toBe(true)
  })
  it('falta uma palavra dá false', () => {
    expect(matchesSearch(frase, searchTokens('casa zzz'))).toBe(false)
  })
  it('tokens vazios dá true', () => {
    expect(matchesSearch('qualquer', [])).toBe(true)
  })
  it('casa literal, sem regex', () => {
    const h = normalizeForSearch("Nota Exemplo [Pt.4 v3.07] Alfa'X")
    expect(matchesSearch(h, searchTokens("[pt.4 alfa'x"))).toBe(true)
    expect(matchesSearch(h, searchTokens('('))).toBe(false)
    expect(matchesSearch(h, searchTokens('*'))).toBe(false)
  })
})
