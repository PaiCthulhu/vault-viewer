// Sessão das rotas que agem dentro de um vault. Nada aqui vem do JWT além do id do usuário:
// nome, papel de admin e nível no vault são lidos do banco a cada chamada, então rebaixar ou
// apagar um usuário vale na hora, mesmo com o token ainda dentro da validade.
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import type { VaultConfig } from '@/types'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import { dbGetUserById, dbUserHasVaultAccess, dbGetUserVaultLevel } from '@/lib/db'
import { getVaultBySlug } from '@/lib/vault-config'

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

const fail = (status: number, error: string): NextResponse => json({ error }, status)

export interface VaultSession {
  vault: VaultConfig
  userId: number
  username: string
  isAdmin: boolean
}

// Passos comuns, nesta ordem: sessão válida; o usuário ainda existe no banco (o JWT de um
// usuário apagado vale até expirar); acesso ao vault (o admin dispensa); o vault existe.
export async function vaultSession(slug: string): Promise<VaultSession | NextResponse> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return fail(401, 'Não autenticado')
  const payload = await verifyToken(token)
  if (!payload) return fail(401, 'Token inválido')

  const user = dbGetUserById(payload.userId)
  if (!user) return fail(401, 'Usuário não existe mais')
  const isAdmin = Boolean(user.is_admin)

  if (!isAdmin && !dbUserHasVaultAccess(user.id, slug)) return fail(403, 'Sem acesso')

  const vault = getVaultBySlug(slug)
  if (!vault) return fail(404, 'Vault não encontrado')

  return { vault, userId: user.id, username: user.username, isAdmin }
}

// Quem pode editar o vault: a sessão comum e, para quem não é admin, nível `editor` gravado
// no banco. O admin conta como editor em todo vault. Um leitor leva 403.
export async function editorSession(slug: string): Promise<VaultSession | NextResponse> {
  const session = await vaultSession(slug)
  if (session instanceof NextResponse) return session
  if (!session.isAdmin && dbGetUserVaultLevel(session.userId, slug) !== 'editor') {
    return fail(403, 'Sem permissão de edição neste vault')
  }
  return session
}
