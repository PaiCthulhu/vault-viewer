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
