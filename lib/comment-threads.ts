// Conversas da faixa de comentários, no cliente: a ordem, e o que a faixa mostra entre uma
// escrita do usuário e o build que a confirma. Tudo puro, sem React nem rede.
//
// A faixa mostra o que veio no `PageMeta` (o "servidor") mais o que este navegador acabou
// de escrever (o "local": o comentário que a API devolveu). O servidor manda assim que
// alcança o local; até lá o local cobre a diferença, para o comentário aparecer na hora e
// não sumir num refresh que chegou antes do build.
import type { CommentThread, PageComment } from '@/builder/types'
import { commentVersion } from '@/lib/comment-version'

export interface LocalEdit {
  comment: PageComment
  // Versão da cópia do servidor quando a edição foi feita (`null` = o servidor não a tinha).
  base: string | null
}

export interface LocalComments {
  // Criados aqui e ainda não vistos no servidor. `replyTo` = caminho do principal.
  added: { comment: PageComment; replyTo: string | null }[]
  // Editados aqui, por caminho.
  edited: Record<string, LocalEdit>
  // Apagados aqui.
  deleted: string[]
}

export const NO_LOCAL: LocalComments = { added: [], edited: {}, deleted: [] }

// Texto ISO UTC compara como texto; `null` vai para o fim.
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

// A mesma ordem que o build grava (`sortThreads` de builder/comments.ts, que não pode ser
// importado no cliente): respostas por `createdAt` crescente; conversas pela última
// atividade, a mais recente primeiro; `null` no fim; empate pelo caminho.
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

export function findComment(threads: CommentThread[], path: string): PageComment | null {
  for (const t of threads) {
    if (t.comment.path === path) return t.comment
    for (const r of t.replies) if (r.path === path) return r
  }
  return null
}

// A edição local ainda vale sobre a cópia do servidor? Vale enquanto o servidor não mudou
// desde a edição, ou enquanto a cópia dele é mais velha (um build no meio de duas edições
// seguidas traz a primeira).
function localEditWins(edit: LocalEdit, server: PageComment): boolean {
  if (edit.base !== null && commentVersion(server) === edit.base) return true
  const mine = edit.comment.updatedAt
  return mine !== null && (server.updatedAt === null || mine > server.updatedAt)
}

// O que a faixa mostra: o servidor, mais o local que ele ainda não alcançou.
export function mergeThreads(server: CommentThread[], local: LocalComments): CommentThread[] {
  const deleted = new Set(local.deleted)
  const fromServer = (c: PageComment): PageComment => {
    const edit = local.edited[c.path]
    return edit && localEditWins(edit, c) ? edit.comment : c
  }
  const fromLocal = (c: PageComment): PageComment => local.edited[c.path]?.comment ?? c

  const threads: CommentThread[] = server.map(t => ({
    comment: fromServer(t.comment),
    replies: t.replies.map(fromServer),
  }))

  const known = new Set<string>()
  for (const t of server) {
    known.add(t.comment.path)
    for (const r of t.replies) known.add(r.path)
  }

  // Principais primeiro, para uma resposta local achar o principal local.
  for (const a of local.added) {
    if (a.replyTo !== null || known.has(a.comment.path)) continue
    known.add(a.comment.path)
    threads.push({ comment: fromLocal(a.comment), replies: [] })
  }
  for (const a of local.added) {
    if (a.replyTo === null || known.has(a.comment.path)) continue
    // Sem o principal (apagado por outra pessoa), a resposta não tem onde aparecer.
    const thread = threads.find(t => t.comment.path === a.replyTo)
    if (!thread) continue
    known.add(a.comment.path)
    thread.replies.push(fromLocal(a.comment))
  }

  return sortThreads(
    threads
      .filter(t => !deleted.has(t.comment.path))
      .map(t => ({ comment: t.comment, replies: t.replies.filter(r => !deleted.has(r.path)) })),
  )
}

// Chamado quando chega um `PageMeta` novo: esquece o local que o servidor já alcançou.
// Um criado que o servidor já mostrou sai daqui, e por isso não volta se outra pessoa o
// apagar depois. Devolve o mesmo objeto quando nada muda.
export function pruneLocal(server: CommentThread[], local: LocalComments): LocalComments {
  const added = local.added.filter(a => findComment(server, a.comment.path) === null)
  const edited: Record<string, LocalEdit> = {}
  let editedChanged = false
  for (const [path, edit] of Object.entries(local.edited)) {
    const s = findComment(server, path)
    if (s !== null && !localEditWins(edit, s)) editedChanged = true
    else edited[path] = edit
  }
  if (added.length === local.added.length && !editedChanged) return local
  return { added, edited, deleted: local.deleted }
}

export function localAdd(local: LocalComments, comment: PageComment, replyTo: string | null): LocalComments {
  return { ...local, added: [...local.added, { comment, replyTo }] }
}

// `server` = as conversas do `PageMeta` no momento da edição.
export function localEdit(local: LocalComments, comment: PageComment, server: CommentThread[]): LocalComments {
  const current = findComment(server, comment.path)
  return {
    ...local,
    edited: { ...local.edited, [comment.path]: { comment, base: current ? commentVersion(current) : null } },
  }
}

// Apagar um principal leva as respostas locais dele junto (as do servidor somem com a conversa).
export function localDelete(local: LocalComments, path: string): LocalComments {
  return {
    ...local,
    added: local.added.filter(a => a.comment.path !== path && a.replyTo !== path),
    deleted: local.deleted.includes(path) ? local.deleted : [...local.deleted, path],
  }
}

export interface AuthorLabel {
  name: string // nome de exibição, ou o `author` cru de um autor desconhecido ('' se não há)
  handle: string // '@username', ou '' para um autor desconhecido
}

// `displayNames`: username → nome de exibição (`null` = usuário sem nome). Quem não está
// no mapa não é usuário do viewer (arquivo escrito à mão): mostra o `author` como está.
export function authorLabel(author: string, displayNames: Record<string, string | null>): AuthorLabel {
  if (!Object.prototype.hasOwnProperty.call(displayNames, author)) return { name: author, handle: '' }
  return { name: displayNames[author] ?? '', handle: '@' + author }
}
