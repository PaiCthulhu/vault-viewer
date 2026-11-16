// Busca por texto da barra de filtros das galerias. Lógica pura, sem DOM.
// Ignora maiúsculas e acentos; com várias palavras, todas precisam aparecer, em qualquer ordem.
// Casa substring literal (`includes`): nada de regex, então `(`, `*` e `[` são caracteres comuns.

// NFD separa a letra da marca combinante (ç → c + cedilha); tirada a marca, sobra a base.
export function normalizeForSearch(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Palavras da consulta, já normalizadas. Espaço sobrando e consulta vazia dão [].
export function searchTokens(query: string): string[] {
  return normalizeForSearch(query).split(/\s+/).filter((t) => t !== '')
}

// `haystack` já vem normalizado (quem chama normaliza uma vez por card, não a cada tecla).
// Sem tokens, tudo casa.
export function matchesSearch(haystack: string, tokens: string[]): boolean {
  return tokens.every((t) => haystack.includes(t))
}
