// O que a rota de propriedades faz em volta da gravação: o log, o rebuild silencioso e a
// tradução dos erros em resposta. A escrita no disco fica em `lib/property-store.ts`.
import { NextResponse } from 'next/server'
import { json } from '@/lib/vault-session'
import { runRebuild } from '@/lib/rebuild'
import { wroteFirst } from '@/lib/vault-write'
import { PropertyError } from '@/lib/property-store'
import { yamlString } from '@/lib/frontmatter-edit'

export interface PropertyWriteContext {
  slug: string
  username: string
  key: string
}

// Depois de cada gravação (e de um erro que veio com o disco já mudado): uma linha de log,
// com aspas JSON (`yamlString`, que também escapa DEL, C1, U+2028, U+2029 e U+FEFF) para nada
// do usuário injetar texto no log, e o build com a nota na frente,
// sem esperar. Pedidos seguidos se juntam num build só (`runRebuild`).
export function afterPropertyWrite(ctx: PropertyWriteContext, notePath: string | null): void {
  console.log(
    `[properties] ${yamlString(ctx.username)} ${yamlString(ctx.slug)} ${notePath === null ? 'null' : yamlString(notePath)} ${yamlString(ctx.key)}`,
  )
  void runRebuild(ctx.slug, { first: notePath ? [notePath] : [] }).catch(err =>
    console.error(`[properties] erro ao pedir o build de ${JSON.stringify(ctx.slug)}:`, err),
  )
}

// Erro da loja vira a resposta com o status dele; qualquer outro é 500, com o detalhe só no
// log. Se o disco já tinha mudado quando o erro veio, o log e o build saem assim mesmo.
export function propertyErrorResponse(err: unknown, ctx: PropertyWriteContext): NextResponse {
  const notePath = wroteFirst(err)
  if (notePath !== undefined) afterPropertyWrite(ctx, notePath)
  if (err instanceof PropertyError) return json({ error: err.message, ...err.extra }, err.status)
  console.error('[properties] erro ao gravar a propriedade:', err)
  return json({ error: 'Erro ao gravar a propriedade' }, 500)
}
