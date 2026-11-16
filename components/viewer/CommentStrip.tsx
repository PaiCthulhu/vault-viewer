'use client'

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { CommentThread, PageComment } from '@/builder/types'
import {
  NO_LOCAL, authorLabel, findComment, localAdd, localDelete, localEdit, mergeThreads, pruneLocal,
  type LocalComments,
} from '@/lib/comment-threads'
import {
  MAX_COMMENT_CHARS, deleteComment, normalizeDraft, patchComment, postComment,
} from '@/lib/comment-client'

export interface CommentStripProps {
  slug: string
  // Caminho da nota comentada (a mãe).
  pagePath: string
  // Conversas do `PageMeta`, na ordem do build; ausente = nenhuma.
  threads?: CommentThread[]
  // username → nome de exibição (`null` = sem nome); fora do mapa = autor desconhecido.
  displayNames: Record<string, string | null>
  username: string
  isAdmin: boolean
}

// Quantas conversas aparecem antes do "Ver todos".
export const VISIBLE_THREADS = 3

const NO_THREADS: CommentThread[] = []

// O que o usuário está fazendo na faixa. Uma coisa por vez: enquanto há um campo aberto,
// os outros botões ficam desligados, para um clique não jogar fora o texto digitado.
type Action =
  | { kind: 'new' }
  | { kind: 'reply'; path: string } // caminho do principal
  | { kind: 'edit'; path: string }
  | { kind: 'delete'; path: string }

const noSubscribe = () => () => {}

// false no servidor e na hidratação, true depois: a data local do navegador não pode sair
// no HTML do servidor (outro fuso daria erro de hidratação).
function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false)
}

// O HTML do comentário (render restrito do builder). Memoizado: o React 19 reaplica o
// innerHTML a cada objeto `{__html}` novo, e a faixa re-renderiza a cada tecla.
const CommentBody = memo(function CommentBody({ html }: { html: string }) {
  const inner = useMemo(() => ({ __html: html }), [html])
  const ref = useRef<HTMLDivElement>(null)
  // Link externo abre em nova aba, como os da nota.
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLAnchorElement>('a[href^="http://"], a[href^="https://"]').forEach(a => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })
  }, [html])
  return <div ref={ref} className="vault-comment-body" dangerouslySetInnerHTML={inner} />
})

export function CommentStrip({ slug, pagePath, threads, displayNames, username, isAdmin }: CommentStripProps) {
  const { t, locale } = useI18n()
  const hydrated = useHydrated()
  const server = threads ?? NO_THREADS

  const [local, setLocal] = useState<LocalComments>(NO_LOCAL)
  const [expanded, setExpanded] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  // Chegou um `PageMeta` novo (refresh depois do build): esquece o local que ele já traz.
  const [seen, setSeen] = useState(server)
  if (seen !== server) {
    setSeen(server)
    setLocal(l => pruneLocal(server, l))
  }

  // O `PageMeta` mais recente, para o que roda depois de um `await` (a resposta da API
  // pode chegar depois de um refresh).
  const serverRef = useRef(server)
  useEffect(() => {
    serverRef.current = server
  }, [server])

  const merged = useMemo(() => mergeThreads(server, local), [server, local])

  const dateFormat = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })
    } catch {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
    }
  }, [locale])
  const formatDate = (iso: string): string => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : dateFormat.format(d)
  }

  const normalized = normalizeDraft(draft)
  const tooLong = normalized.length > MAX_COMMENT_CHARS
  const canSend = !busy && normalized !== '' && !tooLong

  function open(next: Action, text = '') {
    setAction(next)
    setDraft(text)
    setErrorKey(null)
  }

  function close() {
    setAction(null)
    setDraft('')
    setErrorKey(null)
  }

  async function submit() {
    if (!action || action.kind === 'delete' || !canSend) return
    setBusy(true)
    setErrorKey(null)
    try {
      if (action.kind === 'edit') {
        const current = findComment(merged, action.path)
        if (!current) {
          setErrorKey('comments.error.gone')
          return
        }
        const res = await patchComment(slug, current, normalized)
        const now = serverRef.current
        if (res.ok) {
          setLocal(l => localEdit(l, res.comment, now))
          close()
        } else {
          // 409: o arquivo mudou. Mostra o comentário como está no disco e mantém o texto
          // digitado; o próximo "Salvar" já vai com a versão nova.
          const onDisk = res.comment
          if (onDisk) setLocal(l => localEdit(l, onDisk, now))
          setErrorKey(res.errorKey)
        }
        return
      }
      const parent = action.kind === 'reply' ? action.path : pagePath
      const res = await postComment(slug, parent, normalized)
      if (res.ok) {
        // Se o refresh chegou antes desta resposta, o servidor já traz o comentário: guardar
        // a cópia local o faria voltar caso alguém o apagasse depois.
        const known = findComment(serverRef.current, res.comment.path) !== null
        if (!known) setLocal(l => localAdd(l, res.comment, res.replyTo))
        close()
      } else {
        setErrorKey(res.errorKey)
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!action || action.kind !== 'delete' || busy) return
    const path = action.path
    setBusy(true)
    setErrorKey(null)
    try {
      const res = await deleteComment(slug, path)
      // 404: o comentário já não existe; para a faixa dá no mesmo que apagado.
      if (res.ok || res.status === 404) {
        setLocal(l => localDelete(l, path))
        close()
      } else {
        setErrorKey(res.errorKey)
      }
    } finally {
      setBusy(false)
    }
  }

  // A conversa em que o usuário está mexendo não some atrás do "Ver todos" se a ordem mudar.
  const pinned = action && action.kind !== 'new' ? action.path : null
  const visible = expanded
    ? merged
    : merged.filter(
        (th, i) =>
          i < VISIBLE_THREADS ||
          (pinned !== null && (th.comment.path === pinned || th.replies.some(r => r.path === pinned))),
      )
  const idle = action === null

  function form(kind: 'new' | 'reply' | 'edit') {
    const label = t(kind === 'new' ? 'comments.newLabel' : kind === 'reply' ? 'comments.replyLabel' : 'comments.editLabel')
    const placeholder = t(kind === 'reply' ? 'comments.replyPlaceholder' : 'comments.placeholder')
    const sendLabel = kind === 'edit'
      ? t(busy ? 'common.saving' : 'common.save')
      : t(busy ? 'comments.sending' : 'comments.send')
    return (
      <form
        className="vault-comment-form"
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
      >
        <textarea
          className="vault-comment-input"
          aria-label={label}
          placeholder={placeholder}
          rows={3}
          value={draft}
          readOnly={busy}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        {tooLong && (
          <p className="vault-comment-error" role="alert">
            {t('comments.tooLong', { max: MAX_COMMENT_CHARS, count: normalized.length })}
          </p>
        )}
        {errorKey && <p className="vault-comment-error" role="alert">{t(errorKey)}</p>}
        <div className="vault-comment-form-actions">
          <button type="submit" className="vault-comment-btn is-primary" disabled={!canSend}>{sendLabel}</button>
          <button type="button" className="vault-comment-btn" disabled={busy} onClick={close}>{t('common.cancel')}</button>
        </div>
      </form>
    )
  }

  function comment(c: PageComment, replyCount: number | null) {
    const isPrincipal = replyCount !== null
    const { name, handle } = authorLabel(c.author, displayNames)
    const mine = c.author === username
    const editing = action?.kind === 'edit' && action.path === c.path
    const deleting = action?.kind === 'delete' && action.path === c.path
    const n = replyCount ?? 0
    return (
      <div className={'vault-comment' + (isPrincipal ? '' : ' is-reply')} data-comment-path={c.path}>
        <div className="vault-comment-meta">
          {name !== '' && <span className="vault-comment-name">{name}</span>}
          {handle !== '' && <span className="vault-comment-handle">{handle}</span>}
          {name === '' && handle === '' && (
            <span className="vault-comment-name is-unknown">{t('comments.unknownAuthor')}</span>
          )}
          {c.createdAt && (
            <time className="vault-comment-date" dateTime={c.createdAt}>
              {hydrated ? formatDate(c.createdAt) : ''}
            </time>
          )}
          {c.updatedAt && (
            <span className="vault-comment-edited" title={hydrated ? formatDate(c.updatedAt) : undefined}>
              {t('comments.edited')}
            </span>
          )}
        </div>

        {editing ? form('edit') : <CommentBody html={c.html} />}

        {deleting && (
          <div
            className="vault-comment-confirm"
            role="alertdialog"
            aria-label={t('comments.delete')}
            onKeyDown={e => {
              if (e.key === 'Escape' && !busy) close()
            }}
          >
            <p className="vault-comment-confirm-text">
              {n === 0
                ? t('comments.deleteConfirm')
                : t(n === 1 ? 'comments.deleteConfirmOne' : 'comments.deleteConfirmMany', { count: n })}
            </p>
            {errorKey && <p className="vault-comment-error" role="alert">{t(errorKey)}</p>}
            <div className="vault-comment-form-actions">
              <button type="button" className="vault-comment-btn is-danger" disabled={busy} onClick={() => void confirmDelete()}>
                {t(busy ? 'comments.deleting' : 'comments.delete')}
              </button>
              {/* O foco vai para o "Cancelar": a barra de botões saiu da tela e, sem isto, ele cairia no body. */}
              <button type="button" className="vault-comment-btn" disabled={busy} autoFocus onClick={close}>{t('common.cancel')}</button>
            </div>
          </div>
        )}

        {!editing && !deleting && (
          <div className="vault-comment-actions">
            {isPrincipal && (
              <button type="button" className="vault-comment-action" data-action="reply" disabled={!idle} onClick={() => open({ kind: 'reply', path: c.path })}>
                {t('comments.reply')}
              </button>
            )}
            {mine && (
              <button type="button" className="vault-comment-action" data-action="edit" disabled={!idle} onClick={() => open({ kind: 'edit', path: c.path }, c.body)}>
                {t('comments.edit')}
              </button>
            )}
            {(mine || isAdmin) && (
              <button type="button" className="vault-comment-action" data-action="delete" disabled={!idle} onClick={() => open({ kind: 'delete', path: c.path })}>
                {t('comments.delete')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="vault-comments" aria-label={t('comments.title')}>
      <div className="vault-comments-head">
        <span className="vault-comments-title">{t('comments.title')}</span>
        <button type="button" className="vault-comment-btn vault-comments-write" disabled={!idle} onClick={() => open({ kind: 'new' })}>
          {t('comments.write')}
        </button>
      </div>

      {action?.kind === 'new' && form('new')}

      {merged.length === 0 && <p className="vault-comments-empty">{t('comments.empty')}</p>}

      {visible.map(th => (
        <div key={th.comment.path} className="vault-comment-thread">
          {comment(th.comment, th.replies.length)}
          {(th.replies.length > 0 || (action?.kind === 'reply' && action.path === th.comment.path)) && (
            <div className="vault-comment-replies">
              {th.replies.map(r => (
                <div key={r.path}>{comment(r, null)}</div>
              ))}
              {action?.kind === 'reply' && action.path === th.comment.path && form('reply')}
            </div>
          )}
        </div>
      ))}

      {!expanded && merged.length > visible.length && (
        <button type="button" className="vault-comments-more" onClick={() => setExpanded(true)}>
          {t('comments.showAll', { count: merged.length })}
        </button>
      )}
    </section>
  )
}
