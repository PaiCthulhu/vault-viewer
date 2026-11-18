// Cor de um chip de propriedade de lista. Função pura, sem DOM nem Node:
// roda igual no builder e no browser, então a mesma etiqueta tem a mesma cor
// nos dois lados.

export const PROPERTY_COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const

export type PropertyColor = (typeof PROPERTY_COLORS)[number]

/** FNV-1a de 32 bits sobre as unidades UTF-16 de chave + NUL + valor (NFC). */
export function propertyColor(key: string, value: string): PropertyColor {
  const text = key.normalize('NFC') + '\u0000' + value.normalize('NFC')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return PROPERTY_COLORS[(h >>> 0) % PROPERTY_COLORS.length]
}

/**
 * Cores que um chip pode ter. `default` (a cor mais clara do Notion) só existe como cor
 * escolhida no `.vaultwright`: nunca sai do hash, por isso não está em `PROPERTY_COLORS`.
 */
export const CHIP_COLORS = [...PROPERTY_COLORS, 'default'] as const

export type ChipColor = PropertyColor | 'default'

export function isChipColor(x: unknown): x is ChipColor {
  return typeof x === 'string' && (CHIP_COLORS as readonly string[]).includes(x)
}

/** Cores escolhidas por valor (`colors` do `.vaultwright`), já validadas. */
export type ChosenColors = Readonly<Record<string, ChipColor>>

/** A cor escolhida para o valor, se houver; senão a do hash. */
export function chipColor(key: string, value: string, colors?: ChosenColors): ChipColor {
  if (colors && Object.hasOwn(colors, value)) {
    const chosen: unknown = colors[value]
    if (isChipColor(chosen)) return chosen
  }
  return propertyColor(key, value)
}
