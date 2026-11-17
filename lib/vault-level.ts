import type { VaultLevel } from '@/types'

// Níveis de acesso a um vault, do menor para o maior
export const VAULT_LEVELS: readonly VaultLevel[] = ['reader', 'editor']

// Comparação exata: sem trim nem diferença de caixa
export function isVaultLevel(v: unknown): v is VaultLevel {
  return typeof v === 'string' && (VAULT_LEVELS as readonly string[]).includes(v)
}
