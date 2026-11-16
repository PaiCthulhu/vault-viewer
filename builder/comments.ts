// Comentários no build: agrupa as notas `note_type: comment` em conversas, anexadas à
// nota-mãe, e lê os campos de cada comentário. O corpo passa só pelo render restrito
// (`comment-render.ts`), nunca pelo render completo da página (que roda dataviewjs).
import type { CommentThread, PageComment } from './types'
import type { NoteFamilies } from './note-family'
import { renderComment, type CommentRenderOptions } from './comment-render'

// Onde o viewer encaixa a área de comentários: logo depois das Propriedades.
export const COMMENTS_MARKER = '<div class="vault-comments-slot"></div>'

// Data do frontmatter em ISO UTC. O YAML sem aspas vira `Date`; com aspas, texto.
// Qualquer outra coisa (ausente, lixo, número) é `null`: nunca quebra o build.
export function commentTime(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    const d = new Date(v.trim())
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

export function toPageComment(
  note: { path: string; frontmatter: Record<string, unknown>; body: string },
  opts: CommentRenderOptions,
): PageComment {
  const a = note.frontmatter.author
  return {
    path: note.path,
    author: typeof a === 'string' || typeof a === 'number' ? String(a).trim() : '',
    createdAt: commentTime(note.frontmatter.created_at),
    updatedAt: commentTime(note.frontmatter.updated_at),
    body: note.body,
    html: renderComment(note.body, opts),
  }
}

export interface ThreadRef {
  principal: string
  replies: string[]
}

// Conversas por mãe (chave = caminho da mãe). Só os comentários válidos
// (`families.comments`) entram: cada um sobe por `parent` enquanto o alvo também é
// comentário válido; o último da cadeia é o principal e os demais são respostas dele.
// Órfão, ignorado: sem mãe resolvida, ciclo, mãe escondida (aba) ou alvo sem página que
// não é comentário (um ignorado de `_comments/` não vira elo da cadeia nem mãe).
export function groupComments(families: NoteFamilies): Map<string, ThreadRef[]> {
  const byMother = new Map<string, Map<string, Set<string>>>()

  for (const start of families.comments) {
    const chain = [start]
    const seen = new Set(chain)
    let mother: string | null = null
    let cur = start
    for (;;) {
      const next = families.parentOf.get(cur)
      if (next === undefined) break
      if (!families.comments.has(next)) {
        // Ignorado de `_comments/` (sem página, mas não é comentário): órfão.
        if (!families.noPage.has(next)) mother = next
        break
      }
      if (seen.has(next)) break // ciclo
      seen.add(next)
      chain.push(next)
      cur = next
    }
    if (mother === null || families.hidden.has(mother)) continue

    const principal = chain[chain.length - 1]
    const threads = byMother.get(mother) ?? new Map<string, Set<string>>()
    const replies = threads.get(principal) ?? new Set<string>()
    for (const c of chain.slice(0, -1)) replies.add(c)
    threads.set(principal, replies)
    byMother.set(mother, threads)
  }

  const out = new Map<string, ThreadRef[]>()
  for (const [mother, threads] of byMother) {
    out.set(mother, [...threads].map(([principal, replies]) => ({ principal, replies: [...replies] })))
  }
  return out
}

// Texto ISO UTC compara como texto; `null` vai para o fim; empate pelo caminho.
function compareNullable(a: string | null, b: string | null, desc: boolean): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return desc ? (a < b ? 1 : -1) : a < b ? -1 : 1
}

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function lastActivity(t: CommentThread): string | null {
  let max: string | null = null
  for (const c of [t.comment, ...t.replies]) {
    for (const v of [c.createdAt, c.updatedAt]) {
      if (v !== null && (max === null || v > max)) max = v
    }
  }
  return max
}

// Respostas por `createdAt` crescente; conversas pela última atividade, a mais
// recente primeiro. Não muta a entrada.
export function sortThreads(threads: CommentThread[]): CommentThread[] {
  return threads
    .map(t => ({
      comment: t.comment,
      replies: [...t.replies].sort(
        (a, b) => compareNullable(a.createdAt, b.createdAt, false) || byPath(a.path, b.path),
      ),
    }))
    .sort(
      (a, b) =>
        compareNullable(lastActivity(a), lastActivity(b), true) || byPath(a.comment.path, b.comment.path),
    )
}
