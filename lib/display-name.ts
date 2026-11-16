export const DISPLAY_NAME_MAX = 80

// Nome de exibição do usuário: opcional, texto simples de uma linha.
export function validateDisplayName(input: unknown): { value: string | null } | { error: string } {
  if (input === null) return { value: null }
  if (typeof input !== 'string') return { error: 'displayName deve ser texto ou null' }
  const value = input.trim()
  if (value === '') return { value: null }
  if (value.length > DISPLAY_NAME_MAX) {
    return { error: `displayName deve ter no máximo ${DISPLAY_NAME_MAX} caracteres` }
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { error: 'displayName não pode ter caracteres de controle' }
  }
  return { value }
}
