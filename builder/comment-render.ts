// Render restrito de markdown para comentários de usuários.
//
// Gêmeo "não confiável" de `markdown.ts`: o corpo de um comentário vem de fora, então
// aqui NADA do que o autor escreve vira HTML ou código executável. Diferenças:
//   - sem `allowDangerousHtml`, sem `rehype-raw`, sem `rehype-slug`, sem math;
//   - HTML cru (inline ou em bloco) vira texto, e sai escapado;
//   - imagens (`![a](x)`, `![a][r]`, `![[img]]`) saem como o texto literal do markdown;
//   - rodapé GFM (`[^1]` e a definição `[^1]: texto`) sai como o texto literal do markdown:
//     o remark-rehype geraria ids fixos (`user-content-fn-1`, `footnote-label`), que
//     colidem entre comentários e com a página e deixariam quem comenta sequestrar a
//     navegação por âncora;
//   - link só vira `<a>` com `http`, `https`, `mailto` ou relativo (mesma lógica do
//     `sanitizeUri` do micromark); caso contrário fica só o texto;
//   - wikilinks seguem a semântica de `LinkResolver.replaceWikilinks`, mas como nós da
//     árvore (o apelido nunca é HTML);
//   - callouts, dataview e dataviewjs não são processados: são blockquote e código comuns;
//   - quebra simples de linha vira `<br>`;
//   - corpo com aninhamento demais (`commentTooDeep`) vira texto escapado
//     (`renderCommentFallback`): o parse, o `mdast-util-to-hast` e o `hast-util-to-html`
//     são recursivos e estouram a pilha com milhares de níveis, e alguns padrões dentro do
//     teto de caracteres custam segundos de CPU só no parse.
//
// O módulo é puro e síncrono para ser compartilhado entre o builder e as rotas de API.
// A árvore é percorrida à mão: `unist-util-visit` só existe como dependência transitiva.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { slug } from 'github-slugger'

export interface CommentRenderOptions {
  vaultSlug: string
  // Alvo de wikilink → caminho da página (sem .md), ou undefined se não resolve.
  resolveLink: (target: string) => string | undefined
  // Chamado quando o corpo passou do limite de aninhamento e saiu como texto (o builder loga).
  onFallback?: () => void
}

// ─── Limite de aninhamento ────────────────────────────────────────────────────

// Níveis de contêiner num caminho da raiz até uma folha: citação, lista (a lista e o item
// dela contam como um nível) e os contêineres inline (ênfase, negrito, riscado e link).
export const MAX_COMMENT_NESTING = 32
const LEVEL_TYPES = new Set(['blockquote', 'list', 'emphasis', 'strong', 'delete', 'link', 'linkReference'])

// Teto de delimitadores inline (`*`, `_`, `~`, `]`) por trecho entre linhas em branco. O
// micromark resolve ênfase e fim de rótulo olhando para trás no parágrafo, e o custo cresce
// com o quadrado deles: com 10.000 caracteres, `]` repetido ou `*a ` aninhado gastam quase
// um segundo de CPU só no parse. Uma linha em branco sempre fecha o parágrafo, então o
// trecho entre elas nunca é menor que o parágrafo do micromark. O `[` fica de fora: sem o
// `]` ele não custa nada, e um wikilink conta 2 em vez de 4.
export const MAX_INLINE_DELIMITERS = 500

// Teto de células de tabela no corpo inteiro, contadas como cada `|` mais cada linha, a partir
// da primeira linha com `|` de cada trecho entre linhas em branco (sem `|` no trecho não há
// tabela; uma linha sem `|` depois do cabeçalho também é linha da tabela). O parse da tabela
// GFM cresce com o quadrado das células do corpo, estejam numa tabela só ou em muitas:
// 5.000 delas gastam mais de 200 ms.
export const MAX_TABLE_CELLS = 2000

// Comprimento do marcador de contêiner em `s[i]`: `>`, ou um marcador de lista (`-`, `*`, `+`
// ou `\d{1,9}[.)]`) seguido de espaço, tab ou fim de linha. 0 se não há marcador.
function markerLength(s: string, i: number, end: number): number {
  const c = s[i]
  if (c === '>') return 1
  const ends = (j: number) => j === end || s[j] === ' ' || s[j] === '\t'
  if (c === '-' || c === '*' || c === '+') return ends(i + 1) ? 1 : 0
  let j = i
  while (j < end && j - i < 9 && s[j] >= '0' && s[j] <= '9') j++
  if (j > i && (s[j] === '.' || s[j] === ')') && ends(j + 1)) return j + 1 - i
  return 0
}

// Cerca de código na coluna 0: o caractere e o tamanho, ou null. Com crase, o resto da linha
// não pode ter crase (aí não é cerca para o CommonMark).
function fenceOpen(line: string): { char: string; size: number } | null {
  const m = /^(`{3,}|~{3,})/.exec(line)
  if (!m) return null
  if (m[1][0] === '`' && line.indexOf('`', m[1].length) >= 0) return null
  return { char: m[1][0], size: m[1].length }
}

// Pré-checagem linear, sem parser (`src` com `\n`). Passa do limite quando:
//   - a cadeia de marcadores de contêiner no começo de alguma linha dá mais de 32 níveis. O
//     recuo também conta, porque continua os itens de lista das linhas de cima: cada item
//     continuado pede pelo menos 2 colunas (o marcador e um espaço). Só conta o recuo antes
//     do primeiro marcador de lista da linha, já que depois dele tudo é contêiner novo;
//   - algum trecho entre linhas em branco tem mais de `MAX_INLINE_DELIMITERS` delimitadores
//     inline;
//   - o corpo tem mais de `MAX_TABLE_CELLS` células de tabela.
// O conteúdo de uma cerca de código na coluna 0 não conta para os dois tetos, até a primeira
// linha que começa com `<` (um bloco HTML pode engolir a cerca e terminar antes dela, e aí o
// que viria depois seria parágrafo).
// As contas só erram para mais: um corpo que passa aqui nunca tem mais níveis de contêiner
// que o contado, nem parágrafo com mais delimitadores, nem mais células que o teto.
function linearTooDeep(src: string): boolean {
  let delimiters = 0
  let cells = 0
  let inTable = false
  let fence: { char: string; size: number } | null = null
  let fencesAllowed = true
  let start = 0
  while (start <= src.length) {
    let end = src.indexOf('\n', start)
    if (end < 0) end = src.length

    // Cadeia de contêineres: espaços/tabs e marcadores, nesta ordem, repetidamente.
    let i = start
    let col = 0
    let levels = 0
    let afterList = false
    for (;;) {
      let indent = 0
      while (i < end && (src[i] === ' ' || src[i] === '\t')) {
        const w = src[i] === '\t' ? 4 - (col % 4) : 1
        indent += w
        col += w
        i++
      }
      const m = markerLength(src, i, end)
      if (m === 0) break
      levels += 1 + (afterList ? 0 : indent >> 1)
      if (levels > MAX_COMMENT_NESTING) return true
      if (src[i] === '>') {
        i++
        col++
        if (src[i] === ' ') {
          i++
          col++
        }
      } else {
        afterList = true
        i += m
        col += m
      }
    }

    const line = src.slice(start, end)
    if (fence) {
      const close = /^[ \t]*(`{3,}|~{3,})/.exec(line)
      if (close && close[1][0] === fence.char && close[1].length >= fence.size) fence = null
    } else if (i === end && levels === 0) {
      // Linha em branco: fecha o parágrafo e a tabela.
      delimiters = 0
      inTable = false
    } else {
      if (src[i] === '<') fencesAllowed = false
      fence = fencesAllowed ? fenceOpen(line) : null
      let pipes = 0
      for (let j = i; j < end; j++) {
        const c = src[j]
        if (c === '|') pipes++
        else if ((c === '*' || c === '_' || c === '~' || c === ']') && ++delimiters > MAX_INLINE_DELIMITERS) return true
      }
      if (pipes > 0) inTable = true
      if (inTable && (cells += pipes + 1) > MAX_TABLE_CELLS) return true
    }
    start = end + 1
  }
  return false
}

// Profundidade em níveis da árvore mdast, com pilha explícita (a árvore pode ser funda).
function treeTooDeep(tree: MdNode): boolean {
  const stack: [MdNode, number][] = [[tree, 0]]
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!
    const d = LEVEL_TYPES.has(node.type) ? depth + 1 : depth
    if (d > MAX_COMMENT_NESTING) return true
    for (const child of node.children ?? []) stack.push([child, d])
  }
  return false
}

// O parse de partes do remark (as transformações do GFM) também é recursivo: se mesmo assim
// estourar a pilha, o corpo é fundo demais. `null` nesse caso.
function parseOrNull(parse: () => unknown): MdNode | null {
  try {
    return parse() as MdNode
  } catch (e) {
    if (e instanceof RangeError) return null
    throw e
  }
}

// CRLF e CR solto viram `\n` (o texto chega de HTTP): sem isso sobra `\r` no `<br>`.
const normalizeNewlines = (md: string): string => md.replace(/\r\n?/g, '\n')

const commentParser = () => unified().use(remarkParse).use(remarkGfm)

// O corpo passa do limite de aninhamento? Primeiro a pré-checagem linear; se ela passar, o
// parse (o mesmo do render) e a profundidade da árvore.
export function commentTooDeep(md: string): boolean {
  const src = normalizeNewlines(md)
  if (linearTooDeep(src)) return true
  const tree = parseOrNull(() => commentParser().parse(src))
  return tree === null || treeTooDeep(tree)
}

// O corpo como texto escapado, com `<br>` em cada quebra de linha, dentro de um `<p>`: o que
// um comentário fundo demais mostra no lugar do render.
export function renderCommentFallback(md: string): string {
  const escaped = normalizeNewlines(md)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<p>${escaped.split('\n').join('<br>\n')}</p>`
}

// Nó mdast mínimo: o suficiente para percorrer sem depender dos tipos transitivos.
interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem'])
const LINK_TYPES = new Set(['link', 'linkReference'])
const WIKILINK = /\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g

// Mesma lógica do `sanitizeUri` do micromark: sem `:` (ou com `/`, `?`, `#` antes dele) a URL
// é relativa; senão o esquema tem de ser http, https ou mailto. Antes, a URL é limpa como o
// navegador a lê (tab/LF/CR somem de qualquer posição, espaço e controles C0 das pontas), e o
// que sobra começando com duas barras, normais ou invertidas em qualquer mistura (`//host`,
// `/\host`, `\\host`), é relativo ao protocolo: aponta para outro site, então só o texto fica.
function isSafeUrl(raw: string): boolean {
  const url = raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '')
  if (/^[/\\]{2}/.test(url)) return false
  const colon = url.indexOf(':')
  if (colon < 0) return true
  const before = url.slice(0, colon)
  if (/[/?#]/.test(before)) return true
  return /^(https?|mailto)$/i.test(before)
}

const text = (value: string): MdNode => ({ type: 'text', value })

// Link com href exato (como o `replaceWikilinks` do builder): o `normalizeUri` do
// remark-rehype percent-codificaria acentos do fragmento, então o href vai por hProperties.
function linkNode(href: string, display: string): MdNode {
  return {
    type: 'link',
    url: href,
    children: [text(display)],
    data: { hProperties: { href } },
  }
}

function wikilinkNodes(value: string, opts: CommentRenderOptions): MdNode[] {
  const out: MdNode[] = []
  let last = 0
  WIKILINK.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK.exec(value)) !== null) {
    // `![[img]]` é embed, não wikilink: fica literal.
    if (m.index > 0 && value[m.index - 1] === '!') continue
    const [original, title, heading, alias] = m
    const titleStr = (title ?? '').replace(/\\\s*$/, '').trim()
    const headingStr = (heading ?? '').replace(/\\\s*$/, '').trim()
    const aliasStr = alias?.trim()

    let node: MdNode | null = null
    if (!titleStr && !headingStr) {
      node = null // wikilink inválido: mantém o original
    } else if (!titleStr) {
      node = linkNode(`#${slug(headingStr)}`, aliasStr || headingStr)
    } else {
      const display = aliasStr || titleStr
      const resolved = opts.resolveLink(titleStr)
      const fragment = headingStr ? `#${slug(headingStr)}` : ''
      if (resolved) {
        const href = `/vault/${opts.vaultSlug}/${resolved.split('/').map(encodeURIComponent).join('/')}`
        node = linkNode(`${href}${fragment}`, display)
      } else {
        node = {
          type: 'emphasis',
          data: { hName: 'span', hProperties: { className: ['vault-dead-link'] } },
          children: [text(display)],
        }
      }
    }
    if (!node) continue
    if (m.index > last) out.push(text(value.slice(last, m.index)))
    out.push(node)
    last = m.index + original.length
  }
  if (last < value.length) out.push(text(value.slice(last)))
  return out
}

// Cada `\n` de um nó de texto vira um nó `break`.
function withBreaks(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  for (const n of nodes) {
    if (n.type !== 'text' || !n.value?.includes('\n')) {
      out.push(n)
      continue
    }
    n.value.split('\n').forEach((part, i) => {
      if (i > 0) out.push({ type: 'break' })
      if (part) out.push(text(part))
    })
  }
  return out
}

function restrict(source: string, opts: CommentRenderOptions) {
  // Trecho da fonte que gerou o nó, intacto.
  function literal(node: MdNode): string {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start != null && end != null ? source.slice(start, end) : ''
  }

  function processChildren(parent: MdNode, inLink: boolean): MdNode[] {
    const out: MdNode[] = []
    for (const child of parent.children ?? []) out.push(...processNode(child, parent, inLink))
    return out
  }

  function processNode(node: MdNode, parent: MdNode, inLink: boolean): MdNode[] {
    switch (node.type) {
      case 'image':
      case 'imageReference':
      case 'footnoteReference':
        return withBreaks([text(literal(node))])
      // A definição é bloco (o pai é root, blockquote ou item de lista): vira parágrafo de
      // texto. Nada dentro dela é interpretado, nem os wikilinks.
      case 'footnoteDefinition':
        return [{ type: 'paragraph', children: withBreaks([text(literal(node))]) }]
      case 'html': {
        const t = text(node.value ?? '')
        const nodes = withBreaks([t])
        return FLOW_PARENTS.has(parent.type) ? [{ type: 'paragraph', children: nodes }] : nodes
      }
      case 'definition':
        return node.url != null && !isSafeUrl(node.url) ? [] : [node]
      case 'link': {
        if (node.url != null && !isSafeUrl(node.url)) return processChildren(node, inLink)
        node.children = processChildren(node, true)
        return [node]
      }
      case 'text': {
        const pieces = inLink ? [node] : wikilinkNodes(node.value ?? '', opts)
        return withBreaks(pieces.length ? pieces : [node])
      }
      default:
        if (node.children) {
          node.children = processChildren(node, inLink || LINK_TYPES.has(node.type))
        }
        return [node]
    }
  }

  return (tree: MdNode) => {
    tree.children = processChildren(tree, false)
  }
}

export function renderComment(md: string, opts: CommentRenderOptions): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(function plugin() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tree: any, file: any) => restrict(String(file), opts)(tree)
    })
    .use(remarkRehype)
    .use(rehypeStringify)
  // Mesmas etapas do `commentTooDeep`, mas com um parse só: a árvore checada é a renderizada.
  const src = normalizeNewlines(md)
  const tree = linearTooDeep(src) ? null : parseOrNull(() => processor.parse(src))
  if (tree === null || treeTooDeep(tree)) {
    opts.onFallback?.()
    return renderCommentFallback(src)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hast = processor.runSync(tree as any, src)
  return String(processor.stringify(hast, src))
}
