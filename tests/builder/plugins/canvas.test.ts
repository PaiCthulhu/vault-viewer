import { describe, it, expect } from 'vitest'
import { renderCanvas, canvasTextSources } from '../../../builder/plugins/canvas'
import { LinkResolver } from '../../../builder/link-resolver'
import type { ScannedFile } from '../../../builder/scanner'

const files: ScannedFile[] = [
  { absolutePath: '/v/Aldor.md', relativePath: 'Personalidades/Aldor', title: 'Aldor' },
]
const linkResolver = new LinkResolver(files)
const resolveImage = (p: string) => `/vault-assets/myvault/${p}`
const renderBody = async (md: string) => `<div>${md.trim()}</div>`

const canvasJson = JSON.stringify({
  nodes: [
    { id: 'g1', type: 'group', x: -500, y: -300, width: 1000, height: 360, color: '6', label: '🌎 Worldbuilding' },
    { id: 't1', type: 'text', text: '# Olá\n\n[[Aldor]]', x: -500, y: -800, width: 1000, height: 450, color: '5' },
    { id: 'f1', type: 'file', file: 'Imagens/Geral/Cover.png', x: -500, y: -1080, width: 1500, height: 260 },
  ],
  edges: [],
})

describe('renderCanvas', () => {
  it('produz um div.vault-canvas com aspect-ratio', async () => {
    const html = await renderCanvas(canvasJson, renderBody, resolveImage, linkResolver, 'myvault')
    expect(html).toContain('class="vault-canvas"')
    expect(html).toContain('aspect-ratio:')
  })

  it('posiciona os nós em porcentagens', async () => {
    const html = await renderCanvas(canvasJson, renderBody, resolveImage, linkResolver, 'myvault')
    expect(html).toMatch(/left:\s*[\d.]+%/)
    expect(html).toMatch(/top:\s*[\d.]+%/)
    expect(html).toMatch(/width:\s*[\d.]+%/)
    expect(html).toMatch(/height:\s*[\d.]+%/)
  })

  it('renderiza o conteúdo do nó de texto via renderBody', async () => {
    const html = await renderCanvas(canvasJson, renderBody, resolveImage, linkResolver, 'myvault')
    expect(html).toContain('class="canvas-node canvas-text"')
    expect(html).toContain('# Olá')
  })

  it('renderiza nó de imagem com img', async () => {
    const html = await renderCanvas(canvasJson, renderBody, resolveImage, linkResolver, 'myvault')
    expect(html).toContain('class="canvas-node canvas-image"')
    expect(html).toContain('<img src="/vault-assets/myvault/Imagens/Geral/Cover.png"')
  })

  it('renderiza grupos primeiro (z-index mais baixo)', async () => {
    const html = await renderCanvas(canvasJson, renderBody, resolveImage, linkResolver, 'myvault')
    const groupIdx = html.indexOf('canvas-group')
    const textIdx = html.indexOf('canvas-text')
    expect(groupIdx).toBeGreaterThanOrEqual(0)
    expect(groupIdx).toBeLessThan(textIdx)
  })

  it('aplica a cor da paleta do Obsidian como border-color', async () => {
    const html = await renderCanvas(canvasJson, renderBody, resolveImage, linkResolver, 'myvault')
    expect(html).toContain('border-color: #a882ff') // color 6
  })

  describe('ordem de leitura (order para o reflow mobile)', () => {
    // Returns the `order` value of the canvas-node chunk containing `marker`.
    function orderOf(html: string, marker: string): number {
      const chunks = html.split('<div class="canvas-node')
      const chunk = chunks.find(c => c.includes(marker))
      expect(chunk, `node containing "${marker}"`).toBeDefined()
      const m = chunk!.match(/order:\s*(\d+)/)
      expect(m, `order in node containing "${marker}"`).toBeTruthy()
      return Number(m![1])
    }

    it('atribui order top-to-bottom / left-to-right, com membros logo após seu grupo', async () => {
      const json = JSON.stringify({
        nodes: [
          { id: 'top', type: 'text', text: 'MARK-topo', x: 0, y: 0, width: 100, height: 50 },
          { id: 'g', type: 'group', x: 0, y: 100, width: 300, height: 200, label: 'MARK-grupo' },
          { id: 'inRight', type: 'text', text: 'MARK-dentro-direita', x: 160, y: 120, width: 100, height: 50 },
          { id: 'inLeft', type: 'text', text: 'MARK-dentro-esquerda', x: 10, y: 120, width: 100, height: 50 },
          { id: 'bottom', type: 'text', text: 'MARK-fundo', x: 0, y: 400, width: 100, height: 50 },
        ],
        edges: [],
      })
      const html = await renderCanvas(json, renderBody, resolveImage, linkResolver, 'myvault')

      expect(orderOf(html, 'MARK-topo')).toBe(0)
      expect(orderOf(html, 'MARK-grupo')).toBe(1)
      expect(orderOf(html, 'MARK-dentro-esquerda')).toBe(2)
      expect(orderOf(html, 'MARK-dentro-direita')).toBe(3)
      expect(orderOf(html, 'MARK-fundo')).toBe(4)
    })

    it('mantém grupos primeiro no DOM (z-index) mesmo com order presente', async () => {
      const html = await renderCanvas(canvasJson, renderBody, resolveImage, linkResolver, 'myvault')
      const groupIdx = html.indexOf('canvas-group')
      const textIdx = html.indexOf('canvas-text')
      expect(groupIdx).toBeLessThan(textIdx)
      // image (y=-1080) reads first, text (y=-800) second, group (y=-300) last
      expect(orderOf(html, 'canvas-image')).toBe(0)
      expect(orderOf(html, '# Olá')).toBe(1)
      expect(orderOf(html, 'canvas-group-label')).toBe(2)
    })
  })
})

describe('canvasTextSources', () => {
  it('extrai textos dos nós de texto', () => {
    const { texts } = canvasTextSources(canvasJson)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('[[Aldor]]')
  })
})
