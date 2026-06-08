import { describe, it, expect } from 'vitest'
import { validateTitleProperty } from '@/app/api/admin/vaults/[slug]/route'

describe('validateTitleProperty', () => {
  it('aceita null', () => {
    expect(validateTitleProperty(null)).toEqual({ value: null })
  })

  it('string vazia ou só espaços vira null', () => {
    expect(validateTitleProperty('')).toEqual({ value: null })
    expect(validateTitleProperty('   ')).toEqual({ value: null })
  })

  it('faz trim de uma propriedade válida', () => {
    expect(validateTitleProperty('  titulo  ')).toEqual({ value: 'titulo' })
  })

  it('aceita letras, números, espaço, ponto e hífen', () => {
    expect(validateTitleProperty('display-title 2.0')).toEqual({ value: 'display-title 2.0' })
  })

  it('rejeita tipos não-string', () => {
    expect(validateTitleProperty(123)).toHaveProperty('error')
    expect(validateTitleProperty({})).toHaveProperty('error')
    expect(validateTitleProperty(undefined)).toHaveProperty('error')
  })

  it('rejeita caracteres inválidos', () => {
    expect(validateTitleProperty('tí@tulo')).toHaveProperty('error')
    expect(validateTitleProperty('a/b')).toHaveProperty('error')
  })

  it('rejeita string maior que 40 caracteres', () => {
    expect(validateTitleProperty('a'.repeat(41))).toHaveProperty('error')
    expect(validateTitleProperty('a'.repeat(40))).toEqual({ value: 'a'.repeat(40) })
  })
})
