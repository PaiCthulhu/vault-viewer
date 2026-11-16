import { describe, it, expect } from 'vitest'
import { validateDisplayName, DISPLAY_NAME_MAX } from '@/lib/display-name'

describe('validateDisplayName', () => {
  it('null vira null', () => {
    expect(validateDisplayName(null)).toEqual({ value: null })
  })

  it('só espaços vira null', () => {
    expect(validateDisplayName('  ')).toEqual({ value: null })
  })

  it('faz trim', () => {
    expect(validateDisplayName('  Ana  ')).toEqual({ value: 'Ana' })
  })

  it('aceita o limite e recusa acima dele', () => {
    expect(DISPLAY_NAME_MAX).toBe(80)
    expect(validateDisplayName('a'.repeat(80))).toEqual({ value: 'a'.repeat(80) })
    expect(validateDisplayName('a'.repeat(81))).toHaveProperty('error')
  })

  it('recusa caractere de controle', () => {
    expect(validateDisplayName('a\nb')).toHaveProperty('error')
  })

  it('recusa outros tipos', () => {
    expect(validateDisplayName(42)).toHaveProperty('error')
    expect(validateDisplayName({})).toHaveProperty('error')
    expect(validateDisplayName(undefined)).toHaveProperty('error')
  })
})
