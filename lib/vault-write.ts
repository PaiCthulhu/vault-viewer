// Peças comuns de escrita no vault: troca atômica de arquivo com repetição sob trava do
// Windows, a fila de escritas por vault e o `LinkResolver` do build. Saíram do
// `comment-store` para servirem também a outras escritas no vault.
import fsp from 'fs/promises'
import path from 'path'
import { randomBytes } from 'crypto'
import { setTimeout as sleep } from 'timers/promises'
import { LinkResolver } from '@/builder/link-resolver'
import { isInCommentsFolder } from '@/builder/note-family'
import { scanCanvases, scanVault } from '@/builder/scanner'
import type { VaultIgnore } from '@/builder/vault-ignore'

// ─── Trava do Windows e escrita atômica ───────────────────────────────────────

// Códigos com que o Windows recusa um arquivo que outro programa segura naquele instante
// (antivírus, indexador, o serviço de sincronização, o próprio build lendo).
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRY_DELAYS_MS = [10, 20, 40, 80, 160]

export const codeOf = (e: unknown): string => (e as NodeJS.ErrnoException | undefined)?.code ?? ''

// Repete `op` enquanto a recusa for de trava; qualquer outro erro sai na hora.
export async function overLocks<T>(op: () => Promise<T>): Promise<T> {
  for (const delay of RETRY_DELAYS_MS) {
    try {
      return await op()
    } catch (e) {
      if (!LOCKED.has(codeOf(e))) throw e
    }
    await sleep(delay)
  }
  return op()
}

// Temporário na mesma pasta: começa com ponto e não termina em `.md`, então nem o scanner
// nem o Obsidian o tomam por nota.
export const tempPath = (file: string): string =>
  path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`)

// Apaga o temporário, insistindo sob trava (um antivírus costuma segurar o arquivo recém
// escrito). Se não sair, fica: começa com ponto e ninguém o lê.
export const dropTemp = (temp: string): Promise<void> =>
  overLocks(() => fsp.unlink(temp)).catch(() => undefined)

// Troca o conteúdo de `file` de uma vez: ou fica o antigo inteiro, ou o novo inteiro.
export async function replaceFile(file: string, content: string | Buffer): Promise<void> {
  const temp = tempPath(file)
  try {
    await fsp.writeFile(temp, content, typeof content === 'string' ? { encoding: 'utf8', flag: 'wx' } : { flag: 'wx' })
    await overLocks(() => fsp.rename(temp, file))
  } catch (e) {
    await dropTemp(temp)
    throw e
  }
}

// `file` ainda tem os bytes de `original`? `false` também quando ele sumiu.
async function stillOriginal(file: string, original: Buffer): Promise<boolean> {
  try {
    return (await overLocks(() => fsp.readFile(file))).equals(original)
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return false
    throw e
  }
}

// Como `replaceFile`, mas só troca se `file` ainda tem os bytes de `original` (o que quem
// chama leu). O temporário é gravado, `beforeCheck` roda uma vez (gancho de teste para
// simular outro escritor) e `file` é relido logo antes de **cada** tentativa de `rename`: um
// `rename` preso pelo Windows espera o próximo atraso e volta a reler, então uma mudança
// feita durante a espera não é sobrescrita, e a janela entre conferir e trocar fica mínima.
// As tentativas e os atrasos são os do `overLocks`. `false` = o arquivo mudou ou sumiu (nada
// é gravado nem recriado, o temporário sai). Qualquer outro erro, ou a trava na última
// tentativa, apaga o temporário e é relançado.
export async function replaceFileIfUnchanged(
  file: string,
  content: Buffer,
  original: Buffer,
  beforeCheck?: () => void | Promise<void>,
): Promise<boolean> {
  const temp = tempPath(file)
  try {
    await fsp.writeFile(temp, content, { flag: 'wx' })
    if (beforeCheck) await beforeCheck()
    for (let attempt = 0; ; attempt++) {
      if (!(await stillOriginal(file, original))) {
        await dropTemp(temp)
        return false
      }
      try {
        await fsp.rename(temp, file)
        return true
      } catch (e) {
        if (!LOCKED.has(codeOf(e)) || attempt >= RETRY_DELAYS_MS.length) throw e
      }
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  } catch (e) {
    await dropTemp(temp)
    throw e
  }
}

// ─── Erro depois de o disco mudar ─────────────────────────────────────────────

// Erro que aconteceu depois de o disco já ter mudado: leva a nota a pôr na frente do build
// (a mãe, no caso dos comentários), para a rota pedir o build mesmo respondendo erro (senão
// a página ficaria velha até a próxima escrita).
const WROTE = Symbol('vault-wrote')
type Wrote = { [WROTE]?: { first: string | null } }

export function markWrote(e: unknown, first: string | null): unknown {
  if (typeof e === 'object' && e !== null) (e as Wrote)[WROTE] = { first }
  return e
}

// `undefined` se o erro não veio depois de uma escrita; senão a nota (ou `null`).
export function wroteFirst(e: unknown): string | null | undefined {
  return typeof e === 'object' && e !== null ? (e as Wrote)[WROTE]?.first : undefined
}

// ─── Fila por vault ───────────────────────────────────────────────────────────

// Em `globalThis` pelo mesmo motivo do estado do build (`lib/rebuild.ts`): uma variável de
// módulo pode existir em mais de uma cópia no mesmo processo.
const LOCK_KEY = Symbol.for('vault-viewer.comment-locks')
type GlobalWithLocks = typeof globalThis & { [LOCK_KEY]?: Map<string, Promise<void>> }

export function withVaultLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as GlobalWithLocks
  const locks = (g[LOCK_KEY] ??= new Map<string, Promise<void>>())
  const run = (locks.get(slug) ?? Promise.resolve()).then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(slug, tail)
  void tail.then(() => {
    if (locks.get(slug) === tail) locks.delete(slug)
  })
  return run
}

// ─── Resolução de links ───────────────────────────────────────────────────────

// O mesmo `LinkResolver` do build (`builder/pipeline.ts`): as notas e os canvases que o
// scanner visita, sem os canvases de `_comments/`. Com outro conjunto, o HTML devolvido
// pela API sairia diferente do que o build grava logo depois.
export function vaultLinkResolver(vaultPath: string, ig: VaultIgnore): LinkResolver {
  return new LinkResolver([
    ...scanVault(vaultPath, ig),
    ...scanCanvases(vaultPath, ig).filter(c => !isInCommentsFolder(c.relativePath)),
  ])
}
