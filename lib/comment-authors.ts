import type { PageMeta } from '@/builder/types'
import { dbGetDisplayNames } from '@/lib/db'

// Usernames para resolver: autores de todos os comentários e respostas + o usuário logado;
// sem vazios, sem repetição.
export function commentUsernames(page: PageMeta, viewer: string): string[] {
  const names = new Set<string>()
  if (viewer) names.add(viewer)
  for (const thread of page.comments ?? []) {
    if (thread.comment.author) names.add(thread.comment.author)
    for (const reply of thread.replies) {
      if (reply.author) names.add(reply.author)
    }
  }
  return [...names]
}

// Nomes de exibição vão ao viewer à parte do PageMeta: pageVersion(page) tem de continuar sendo o
// hash do JSON do disco, senão a aba aberta veria versão diferente e daria refresh em laço.
// {} quando a página não é comentável.
export function pageDisplayNames(page: PageMeta, viewer: string): Record<string, string | null> {
  if (page.commentable !== true) return {}
  return dbGetDisplayNames(commentUsernames(page, viewer))
}
