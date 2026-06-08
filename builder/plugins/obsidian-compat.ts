// Obsidian markdown é mais permissivo que CommonMark. Este plugin trata casos
// que o remark-gfm não suporta: highlight `==texto==`, negrito/itálico adjacente
// a caracteres de palavra, e ênfase com espaço interno antes do marcador de fechamento.
//
// IMPORTANTE: transforma APENAS texto fora de blocos de código cercados
// (``` / ~~~ / 4+ backticks) e fora de spans de código inline (`...`).

// Aplica as transformações de compatibilidade a uma região de texto não-código.
function transformNonCode(text: string): string {
  let out = text

  // 1. Highlight: ==texto== → <mark>texto</mark>
  out = out.replace(/==([^=\n]+)==/g, '<mark>$1</mark>')

  // 2. Espaço interno antes do fechamento → NORMALIZA o markdown (move o espaço
  //    para fora do marcador) e deixa o remark parear. DEVE vir ANTES das regras
  //    de adjacência (passo 3): caso contrário, em cadeias como
  //    `**+2 **[**Dex**](url)`, a regra de adjacência parearia o `**` de
  //    fechamento de `+2` com o `**` de abertura de `Dex` (capturando o `[`).
  //    Normalizar `**+2 **` → `**+2** ` separa-o do `[` por um espaço.
  // strong: normaliza espaços internos em AMBOS os lados — `**x **`, `** x**` e
  // `** x **` viram `**x**` com o(s) espaço(s) movido(s) para fora, p/ o remark
  // parear. (Casa também `**x**` sem espaços → inalterado; é idempotente.)
  out = out.replace(
    /\*\*([ \t]*)(\S(?:[^*\n]*?\S)?)([ \t]*)\*\*/g,
    (_, pre: string, content: string, post: string) =>
      (pre ? ' ' : '') + '**' + content + '**' + (post ? ' ' : ''),
  )
  // em: `*x *` → `*x* ` (só fechamento; (?=\S)/(?<![\w*])/(?!\*) evitam bullets e **)
  out = out.replace(/(?<![\w*])\*(?=\S)([^*\n]+?)\s+\*(?!\*)/g, '*$1* ')

  // 3. Strong adjacente a caractere de palavra (não right-flanking em CommonMark),
  //    que o remark não converte sozinho. Após a normalização acima. O conteúdo
  //    NÃO pode atravessar `[ ] ( )` — senão pareia através de links markdown
  //    adjacentes (ex.: `[**Dex**](url)`, cujo `**` de fechamento é precedido por
  //    letra, seria casado como abertura capturando `](url)`).
  //    Fechamento seguido por palavra: **texto**palavra
  out = out.replace(/\*\*(\S(?:[^*\n[\]()]*?\S)?)\*\*(?=[\p{L}\p{N}])/gu, '<strong>$1</strong>')
  //    Espelhado (abertura precedida por palavra): palavra**texto**
  out = out.replace(/(?<=[\p{L}\p{N}])\*\*(\S(?:[^*\n[\]()]*?\S)?)\*\*/gu, '<strong>$1</strong>')

  return out
}

// Divide o markdown em regiões de código e não-código, transformando só as não-código.
export function applyObsidianCompat(markdown: string): string {
  // Tokeniza cercas de código (linhas iniciando com ``` ou ~~~, possivelmente 4+ backticks),
  // e spans de código inline (`...`, ``...``, etc.). Regiões de código são preservadas como estão.
  const lines = markdown.split('\n')
  const result: string[] = []
  let inFence = false
  let fenceMarker = '' // ex: ``` ou ~~~~ ou ````

  for (const line of lines) {
    const fenceMatch = line.match(/^[ \t]*(`{3,}|~{3,})/)
    if (inFence) {
      // Dentro de uma cerca: procura o fechamento (mesmo tipo, comprimento >=).
      result.push(line)
      if (fenceMatch) {
        const m = fenceMatch[1]
        if (m[0] === fenceMarker[0] && m.length >= fenceMarker.length) {
          inFence = false
          fenceMarker = ''
        }
      }
      continue
    }
    if (fenceMatch) {
      // Abre uma cerca.
      inFence = true
      fenceMarker = fenceMatch[1]
      result.push(line)
      continue
    }
    // Linha normal: transforma, preservando spans de código inline.
    result.push(transformLineWithInlineCode(line))
  }

  return result.join('\n')
}

// Transforma uma linha preservando spans de código inline (`...`).
function transformLineWithInlineCode(line: string): string {
  // Divide em segmentos de código inline e texto. Um span de código inline é
  // delimitado por uma sequência de N crases e fechado pela mesma quantidade.
  const segments: Array<{ code: boolean; text: string }> = []
  // Casa uma sequência de abertura (\1) de crases, conteúdo, e fechamento de mesmo tamanho.
  const re = /(`+)([\s\S]*?)\1(?!`)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ code: false, text: line.slice(lastIndex, m.index) })
    }
    segments.push({ code: true, text: m[0] })
    lastIndex = re.lastIndex
  }
  if (lastIndex < line.length) {
    segments.push({ code: false, text: line.slice(lastIndex) })
  }

  return segments.map(s => (s.code ? s.text : transformNonCode(s.text))).join('')
}
