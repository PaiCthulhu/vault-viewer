import fs from 'fs'

// Quantas notas saem na frente, somando as pedidas e as alteradas.
export const FIRST_LIMIT = 20

// Início da varredura do build anterior (startedAt, ou builtAt em index.json antigo).
// null se não há arquivo, ele não lê ou a data é inválida.
export function readPrevScanMs(indexFile: string): number | null {
  try {
    const idx = JSON.parse(fs.readFileSync(indexFile, 'utf-8')) as { startedAt?: string; builtAt?: string }
    const ms = Date.parse(String(idx.startedAt ?? idx.builtAt))
    return Number.isNaN(ms) ? null : ms
  } catch {
    return null
  }
}

// Notas que saem na frente: primeiro as pedidas (na ordem, sem diferenciar caixa,
// trocadas pelo caminho exato; desconhecidas são ignoradas), depois as que mudaram
// depois de `prevScanMs`, da mais recente para a mais antiga (empate: caminho crescente).
export function selectFirstPages(
  explicit: string[],
  notes: { path: string; t: number }[],
  prevScanMs: number | null,
  limit: number = FIRST_LIMIT,
): string[] {
  const byLower = new Map<string, string>()
  for (const n of notes) byLower.set(n.path.toLowerCase(), n.path)

  const out: string[] = []
  const seen = new Set<string>()
  const add = (p: string): void => {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }

  for (const e of explicit) {
    const exact = byLower.get(e.toLowerCase())
    if (exact) add(exact)
  }
  if (prevScanMs !== null) {
    const changed = notes
      .filter(n => n.t > prevScanMs)
      .sort((a, b) => b.t - a.t || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    for (const n of changed) add(n.path)
  }
  return out.slice(0, limit)
}
