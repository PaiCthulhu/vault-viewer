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
})

describe('canvasTextSources', () => {
  it('extrai textos dos nós de texto', () => {
    const { texts } = canvasTextSources(canvasJson)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('[[Aldor]]')
  })
})
