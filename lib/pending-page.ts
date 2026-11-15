import fs from 'fs'
import path from 'path'
import type { PageMeta } from '@/builder/types'
import type { VaultConfig } from '@/types'
import { isScannedPath, noteTime } from '@/builder/scanner'
import { loadVaultIgnore } from '@/builder/vault-ignore'
import { getBuildState, runRebuild, type BuildState } from '@/lib/rebuild'
import { getVaultIndex, pageFilePath, pageJsonMtimeMs } from '@/lib/vault'

export interface PendingDeps {
  buildState(slug: string): BuildState
  requestBuild(slug: string, first: string[]): void
}

const defaultDeps: PendingDeps = {
  buildState: getBuildState,
  requestBuild(slug, first) {
    // runRebuild nunca rejeita, mas um erro aqui não pode virar rejeição solta.
    void runRebuild(slug, { first })
      .then(r => {
        if (!r.ok) console.error(`[pending-page] build de ${slug} falhou: ${r.output}`)
      })
      .catch(err => console.error(`[pending-page] build de ${slug} falhou:`, err))
  },
}

// Caminho seguro: sem "..", sem "\", sem segmento vazio e sem segmento começando com ponto
// (o scanner pula entradas com ponto).
export function safePagePath(p: string): boolean {
  if (!p || p.includes('\\')) return false
  // Caracteres que o Windows e o Obsidian não aceitam em nome de nota. Barram também a sintaxe de
  // stream do NTFS ("Pasta::$INDEX_ALLOCATION"), que contornaria o .viewerignore.
  if (/[<>:"|?*\x00-\x1f]/.test(p)) return false
  return p.split('/').every(seg => seg !== '' && !seg.startsWith('.'))
}

// Condições 1 a 3 da spec (2.3): caminho seguro, nota existe e o scanner a visitaria.
// `t` é o momento da nota (maior entre mtime, ctime e birthtime).
export function noteFor(vault: VaultConfig, p: string): { t: number } | null {
  if (!safePagePath(p)) return null
  const ig = loadVaultIgnore(vault.path)
  let best: number | null = null
  let realRoot: string | undefined
  for (const ext of ['.md', '.canvas']) {
    const rel = p + ext
    let st: fs.Stats
    try {
      st = fs.statSync(path.join(vault.path, ...rel.split('/')))
    } catch {
      continue
    }
    if (!st.isFile()) continue
    if (!isScannedPath(rel, ig)) continue
    // O Windows aceita apelidos para o mesmo caminho (stream NTFS, nome 8.3, ponto ou espaço no fim,
    // pasta link) e o .viewerignore olha só o texto: sem esta checagem ele seria contornado. O
    // caminho canônico do arquivo tem de ser o próprio p + ext (sem diferenciar caixa), o que
    // também alinha com o walkVault, que não entra em pasta link.
    try {
      realRoot ??= fs.realpathSync.native(vault.path)
      const real = fs.realpathSync.native(path.join(vault.path, ...rel.split('/')))
      const canon = path.relative(realRoot, real).split(path.sep).join('/')
      if (canon.startsWith('..') || canon.toLowerCase() !== rel.toLowerCase()) continue
    } catch {
      continue
    }
    const t = noteTime(st)
    if (best === null || t > best) best = t
  }
  return best === null ? null : { t: best }
}

// Último build que olhou o vault: o maior entre o início do último build concluído
// (index.json) e o início da última tentativa (cobre o build que falhou).
export function lastScanMs(slug: string, state: BuildState): number | null {
  const index = getVaultIndex(slug)
  const fromIndex = index ? Date.parse(index.startedAt ?? index.builtAt) : NaN
  const candidates = [Number.isNaN(fromIndex) ? null : fromIndex, state.lastAttemptStartedAt]
    .filter((n): n is number => typeof n === 'number')
  return candidates.length ? Math.max(...candidates) : null
}

export function isPending(
  vault: VaultConfig,
  p: string,
  opts: { trigger: boolean; pageJsonMtimeMs?: number | null },
  deps: Partial<PendingDeps> = {},
): boolean {
  const d = { ...defaultDeps, ...deps }
  const note = noteFor(vault, p)
  if (!note) return false
  // O JSON foi gravado depois da nota: a página já é a versão nova.
  if (opts.pageJsonMtimeMs != null && opts.pageJsonMtimeMs > note.t) return false

  const state = d.buildState(vault.slug)
  // (a) build rodando que começou depois da nota: vai gerar a página.
  if (state.running && state.running.startedAt > note.t) return true
  // (c) build extra na fila: vai varrer o vault depois da nota.
  if (state.queued) return true
  // (b) nenhum build olhou a nota ainda: pede um, com a nota na frente.
  const last = lastScanMs(vault.slug, state)
  if (last === null || note.t > last) {
    if (opts.trigger) d.requestBuild(vault.slug, [p])
    return true
  }
  return false
}

export type PageStatus = 'ready' | 'pending' | 'missing'

// Estado para a rota de status. Só lê: nunca dispara build.
export function pageStatus(vault: VaultConfig, p: string, deps: Partial<PendingDeps> = {}): PageStatus {
  if (!safePagePath(p)) return 'missing'
  let mtime: number | null = null
  const file = pageFilePath(vault.slug, p)
  if (file) {
    try {
      // Um JSON lido no meio da gravação não parseia: conta como inexistente.
      JSON.parse(fs.readFileSync(file, 'utf-8'))
      mtime = pageJsonMtimeMs(vault.slug, p)
    } catch {
      mtime = null
    }
  }

  if (mtime !== null) {
    const note = noteFor(vault, p)
    if (!note || mtime > note.t) return 'ready'
    return isPending(vault, p, { trigger: false, pageJsonMtimeMs: mtime }, deps) ? 'pending' : 'ready'
  }
  return isPending(vault, p, { trigger: false }, deps) ? 'pending' : 'missing'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Página provisória exibida enquanto a real ainda não foi gerada.
export function provisionalPage(p: string): PageMeta {
  const title = p.split('/').pop() ?? p
  return {
    path: p,
    title,
    frontmatter: {},
    allFields: {},
    html: `<article class="vault-content"><h1 class="vault-page-title">${escapeHtml(title)}</h1></article>`,
    outlinks: [],
    tags: [],
    css: '',
  }
}
