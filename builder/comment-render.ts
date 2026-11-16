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
//   - quebra simples de linha vira `<br>`.
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
// é relativa; senão o esquema tem de ser http, https ou mailto.
function isSafeUrl(url: string): boolean {
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
  const result = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(function plugin() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tree: any, file: any) => restrict(String(file), opts)(tree)
    })
    .use(remarkRehype)
    .use(rehypeStringify)
    // CRLF e CR solto viram `\n` (o texto chega de HTTP): sem isso sobra `\r` no `<br>`.
    .processSync(md.replace(/\r\n?/g, '\n'))
  return String(result)
}
