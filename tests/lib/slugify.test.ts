import { describe, it, expect } from 'vitest'
import { slugify, uniqueSlug } from '@/lib/slugify'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My Vault')).toBe('my-vault')
  })

  it('strips diacritics', () => {
    expect(slugify('Drachegötter')).toBe('drachegotter')
    expect(slugify('Projeto Ignís')).toBe('projeto-ignis')
  })

  it('collapses non-alphanumeric runs into a single hyphen', () => {
    expect(slugify('a  --  b__c!!d')).toBe('a-b-c-d')
  })

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  !Hello!  ')).toBe('hello')
  })

  it('returns empty string when there is nothing usable', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('uniqueSlug', () => {
  it('returns the base slug when free', () => {
    expect(uniqueSlug('My Vault', [])).toBe('my-vault')
  })

  it('appends a numeric suffix when taken', () => {
    expect(uniqueSlug('My Vault', ['my-vault'])).toBe('my-vault-2')
    expect(uniqueSlug('My Vault', ['my-vault', 'my-vault-2'])).toBe('my-vault-3')
  })

  it('falls back to "vault" for empty slugs', () => {
    expect(uniqueSlug('!!!', [])).toBe('vault')
    expect(uniqueSlug('!!!', ['vault'])).toBe('vault-2')
  })
})
