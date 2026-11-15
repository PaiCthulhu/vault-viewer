export interface FilterChip { key: string; value: string }
export interface FilterMemory { path: string; chips: FilterChip[] }

// Chips a readicionar quando a barra é remontada para `path`, dadas as propriedades oferecidas
// agora (chave → valores). Outra página ou memória vazia → [].
// Propriedade que deixou de ser oferecida é pulada; valor que não existe mais vira '' ("todos").
export function chipsToRestore(
  memory: FilterMemory | null,
  path: string,
  offered: Map<string, string[]>,
): FilterChip[] {
  if (!memory || memory.path !== path) return []
  const out: FilterChip[] = []
  for (const { key, value } of memory.chips) {
    const values = offered.get(key)
    if (!values) continue
    out.push({ key, value: value !== '' && values.includes(value) ? value : '' })
  }
  return out
}
