import fs from 'fs'
import path from 'path'
import type { PageMeta } from '@/builder/types'
import type { VaultConfig } from '@/types'
import { isScannedPath, noteTime } from '@/builder/scanner'
import { loadVaultIgnore, type VaultIgnore } from '@/builder/vault-ignore'
import { isInCommentsFolder } from '@/builder/note-family'
import { getBuildState, runRebuild, type BuildState } from '@/lib/rebuild'
import { getVaultIndex, pageFilePath, pageJsonMtimeMs } from '@/lib/vault'

export interface PendingDeps {
  buildState(slug: string): BuildState
  requestBuild(slug: string, first: string[]): void
}

const defaultDeps: PendingDeps = {
  buildState: getBuildState,
  requestBuild(slug, first) {
    // A falha do build o runRebuild já loga, uma vez por build: logar o resultado aqui
    // repetiria a linha. Ele também nunca rejeita (um build que lança erro volta como ok:false);
    // o .catch fica de proteção, porque um erro aqui não pode virar rejeição solta.
    void runRebuild(slug, { first })
      .catch(err => console.error(`[pending-page] erro ao pedir o build de ${slug}:`, err))
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

export interface VaultFile {
  abs: string
  // Caminho canônico relativo à raiz (com extensão e `/`), na caixa que está no disco.
  rel: string
  st: fs.Stats
}

// Arquivo comum do vault que o scanner visitaria, pelo caminho relativo com extensão.
// Quem chama já passou o caminho pelo `safePagePath`.
export function scannedVaultFile(vaultPath: string, rel: string, ig: VaultIgnore): VaultFile | null {
  const abs = path.join(vaultPath, ...rel.split('/'))
  let st: fs.Stats
  try {
    st = fs.statSync(abs)
  } catch {
    return null
  }
  if (!st.isFile()) return null
  if (!isScannedPath(rel, ig)) return null
  // O Windows aceita apelidos para o mesmo caminho (stream NTFS, nome 8.3, ponto ou espaço no fim,
  // pasta link) e o .viewerignore olha só o texto: sem esta checagem ele seria contornado. O
  // caminho canônico do arquivo tem de ser o próprio `rel` (sem diferenciar caixa), o que
  // também alinha com o walkVault, que não entra em pasta link.
  try {
    const realRoot = fs.realpathSync.native(vaultPath)
    const real = fs.realpathSync.native(abs)
    const canon = path.relative(realRoot, real).split(path.sep).join('/')
    if (canon.startsWith('..') || canon.toLowerCase() !== rel.toLowerCase()) return null
    return { abs: real, rel: canon, st }
  } catch {
    return null
  }
}

// Condições 1 a 3 da spec (2.3): caminho seguro, nota existe e o scanner a visitaria.
// `t` é o momento da nota (maior entre mtime, ctime e birthtime).
export function noteFor(vault: VaultConfig, p: string): { t: number } | null {
  if (!safePagePath(p)) return null
  // Nada dentro de `_comments/` da raiz vira página (comentário, arquivo ignorado, canvas):
  // sem isto, abrir a URL de um deles pediria um build para depois cair em 404.
  if (isInCommentsFolder(p)) return null
  const ig = loadVaultIgnore(vault.path)
  let best: number | null = null
  for (const ext of ['.md', '.canvas']) {
    const file = scannedVaultFile(vault.path, p + ext, ig)
    if (!file) continue
    const t = noteTime(file.st)
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
