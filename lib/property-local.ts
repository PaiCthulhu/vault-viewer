// Propriedades da página, no cliente: o que o bloco mostra entre uma escrita do usuário e o
// build que a confirma. Espelha `lib/comment-threads.ts`: o "servidor" é o que veio no
// `PageMeta`, o "local" é a linha que este navegador acabou de gravar. Tudo puro.
//
// O estado local é um `Map` (nunca um `Record`): a chave é o nome da propriedade, e
// `constructor` ou `__proto__` são nomes possíveis.
import type { PageProperty, PropertyValue } from '@/builder/types'
import { sameValue } from '@/lib/property-edit'

export interface LocalProperty {
  // A linha que o usuário vê (a provisória, depois a que a API devolveu).
  row: PageProperty
  // Valores que o servidor pode mostrar enquanto o build não alcança `row`: os anteriores.
  stale: PropertyValue[]
  // Há uma gravação em andamento: o local vence mesmo com um valor desconhecido no servidor.
  saving: boolean
}

export type LocalProperties = ReadonlyMap<string, LocalProperty>

export const NO_LOCAL_PROPERTIES: LocalProperties = new Map()

// O local ainda vale sobre a linha do servidor? Não vale quando o servidor já tem o valor;
// vale durante a gravação; e depois dela só enquanto o servidor mostra um valor velho (um
// terceiro valor é de outra pessoa e vence).
export function localWins(entry: LocalProperty, server: PageProperty): boolean {
  if (sameValue(server.value, entry.row.value)) return false
  if (entry.saving) return true
  return entry.stale.some(v => sameValue(v, server.value))
}

// O que o bloco mostra: as linhas do servidor, na ordem dele, com o local que ainda vale.
export function mergeProperties(server: PageProperty[], local: LocalProperties): PageProperty[] {
  if (local.size === 0) return server
  return server.map(row => {
    const entry = local.get(row.key)
    return entry && localWins(entry, row) ? entry.row : row
  })
}

// Chamado quando chega um `PageMeta` novo: esquece o local que o servidor já alcançou ou
// superou. Devolve o mesmo objeto quando nada muda.
export function pruneLocalProperties(server: PageProperty[], local: LocalProperties): LocalProperties {
  if (local.size === 0) return local
  const byKey = new Map(server.map(p => [p.key, p]))
  let next: Map<string, LocalProperty> | null = null
  for (const [key, entry] of local) {
    if (entry.saving) continue
    const row = byKey.get(key)
    if (row === undefined || !localWins(entry, row)) {
      next ??= new Map(local)
      next.delete(key)
    }
  }
  return next ?? local
}

// Os valores que o servidor ainda pode mostrar depois de uma nova edição: os de antes, o da
// linha do servidor agora e o que estava na tela, sem repetir.
export function staleValues(
  prev: LocalProperty | undefined,
  serverRow: PageProperty | undefined,
  shown: PageProperty,
): PropertyValue[] {
  const out: PropertyValue[] = []
  for (const v of [...(prev?.stale ?? []), ...(serverRow ? [serverRow.value] : []), shown.value]) {
    if (!out.some(o => sameValue(o, v))) out.push(v)
  }
  return out
}

export function withLocal(local: LocalProperties, key: string, entry: LocalProperty | undefined): LocalProperties {
  const next = new Map(local)
  if (entry === undefined) next.delete(key)
  else next.set(key, entry)
  return next
}
