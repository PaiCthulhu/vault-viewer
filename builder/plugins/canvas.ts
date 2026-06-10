// Renderiza um Obsidian Canvas (.canvas, JSON) em HTML responsivo.
// Nós são posicionados absolutamente em porcentagens do bounding box.

import type { LinkResolver } from '../link-resolver'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'])

// Paleta de cores do Obsidian Canvas.
const COLOR_MAP: Record<string, string> = {
  '1': '#fb464c',
  '2': '#e9973f',
  '3': '#e0de71',
  '4': '#44cf6e',
  '5': '#53dfdd',
  '6': '#a882ff',
}

interface CanvasNode {
  id: string
  type: 'group' | 'text' | 'file' | 'link'
  x: number
  y: number
  width: number
  height: number
  color?: string
  label?: string
  text?: string
  file?: string
  url?: string
}

interface CanvasData {
  nodes?: CanvasNode[]
  edges?: unknown[]
}

function isImage(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.has(ext)
}

function colorStyle(color: string | undefined): string {
  if (!color) return ''
  const hex = COLOR_MAP[color]
  if (!hex) return ''
  return `border-color: ${hex}; background-color: ${hex}1a;`
}

// Reading order for the mobile reflow: blocks (groups, or ungrouped nodes) are
// sorted top-to-bottom then left-to-right; a group's members come right after
// the group itself, themselves sorted top-to-bottom / left-to-right.
function computeReadingOrder(nodes: CanvasNode[]): Map<string, number> {
  const byPos = (a: CanvasNode, b: CanvasNode) => a.y - b.y || a.x - b.x
  const groups = nodes.filter(n => n.type === 'group')
  const others = nodes.filter(n => n.type !== 'group')

  const containing = (n: CanvasNode): CanvasNode | undefined => {
    const cx = n.x + n.width / 2
    const cy = n.y + n.height / 2
    return groups.find(
      g => cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height,
    )
  }

  interface Block { y: number; x: number; items: CanvasNode[] }
  const blocks: Block[] = []
  const groupBlock = new Map<CanvasNode, Block>()
  for (const g of groups) {
    const b: Block = { y: g.y, x: g.x, items: [g] }
    blocks.push(b)
    groupBlock.set(g, b)
  }
  for (const n of others) {
    const g = containing(n)
    if (g) groupBlock.get(g)!.items.push(n)
    else blocks.push({ y: n.y, x: n.x, items: [n] })
  }
  for (const b of groupBlock.values()) {
    b.items = [b.items[0], ...b.items.slice(1).sort(byPos)]
  }
  blocks.sort((a, b) => a.y - b.y || a.x - b.x)

  const order = new Map<string, number>()
  let i = 0
  for (const b of blocks) for (const n of b.items) order.set(n.id, i++)
  return order
}

export async function renderCanvas(
  jsonRaw: string,
  renderBody: (md: string) => Promise<string>,
  resolveImage: (p: string) => string,
  linkResolver: LinkResolver,
  vaultSlug: string,
): Promise<string> {
  const data = JSON.parse(jsonRaw) as CanvasData
  const nodes = data.nodes ?? []
  // Edges: este canvas não possui; nada a fazer além de ignorá-las com segurança.

  if (nodes.length === 0) {
    return '<div class="vault-canvas"></div>'
  }

  const PAD = 24
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  minX -= PAD
  minY -= PAD
  maxX += PAD
  maxY += PAD

  const W = maxX - minX
  const H = maxY - minY

  const pct = (v: number, total: number): string => `${((v / total) * 100).toFixed(4)}%`

  // Groups primeiro (z-index mais baixo), depois os demais.
  const ordered = [
    ...nodes.filter(n => n.type === 'group'),
    ...nodes.filter(n => n.type !== 'group'),
  ]

  // Ordem de leitura (top-to-bottom, left-to-right) emitida como `order` inline.
  // No desktop o canvas é position:absolute e `order` é inerte; no mobile o CSS
  // troca o container para flex-column e o `order` empilha os nós em ordem de
  // leitura, com cada grupo virando um cabeçalho seguido de seus membros.
  const readingOrder = computeReadingOrder(nodes)

  const parts: string[] = []

  for (const n of ordered) {
    const left = pct(n.x - minX, W)
    const top = pct(n.y - minY, H)
    const width = pct(n.width, W)
    const height = pct(n.height, H)
    const posStyle = `left: ${left}; top: ${top}; width: ${width}; height: ${height}; order: ${readingOrder.get(n.id) ?? 0};`
    const clrStyle = colorStyle(n.color)

    if (n.type === 'group') {
      parts.push(
        `<div class="canvas-node canvas-group" style="${posStyle} ${clrStyle}">` +
          (n.label ? `<span class="canvas-group-label">${n.label}</span>` : '') +
          `</div>`,
      )
    } else if (n.type === 'text') {
      const inner = await renderBody(n.text ?? '')
      parts.push(
        `<div class="canvas-node canvas-text" style="${posStyle} ${clrStyle}">${inner}</div>`,
      )
    } else if (n.type === 'file') {
      const file = n.file ?? ''
      if (isImage(file)) {
        const src = resolveImage(file)
        parts.push(
          `<div class="canvas-node canvas-image" style="${posStyle} ${clrStyle}">` +
            `<img src="${src}" alt=""/>` +
            `</div>`,
        )
      } else if (file.toLowerCase().endsWith('.md')) {
        const title = file.replace(/\.md$/i, '').split('/').pop() ?? file
        const resolved = linkResolver.resolve(title)
        if (resolved) {
          const href = `/vault/${vaultSlug}/${resolved.split('/').map(encodeURIComponent).join('/')}`
          parts.push(
            `<div class="canvas-node canvas-card" style="${posStyle} ${clrStyle}">` +
              `<a href="${href}">${title}</a>` +
              `</div>`,
          )
        }
      }
      // outros tipos de arquivo: ignorar
    } else if (n.type === 'link') {
      const url = n.url ?? ''
      parts.push(
        `<div class="canvas-node canvas-card" style="${posStyle} ${clrStyle}">` +
          `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` +
          `</div>`,
      )
    }
  }

  return `<div class="vault-canvas" style="aspect-ratio: ${W} / ${H};">${parts.join('')}</div>`
}

// Extrai os textos de todos os nós de texto e os nós de arquivo .md (para outlinks).
export function canvasTextSources(jsonRaw: string): { texts: string[]; mdFiles: string[] } {
  const data = JSON.parse(jsonRaw) as CanvasData
  const nodes = data.nodes ?? []
  const texts: string[] = []
  const mdFiles: string[] = []
  for (const n of nodes) {
    if (n.type === 'text' && n.text) texts.push(n.text)
    if (n.type === 'file' && n.file && n.file.toLowerCase().endsWith('.md')) {
      mdFiles.push(n.file)
    }
  }
  return { texts, mdFiles }
}
