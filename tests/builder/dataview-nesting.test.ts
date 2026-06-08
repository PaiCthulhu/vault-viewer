import { describe, it, expect } from 'vitest'
import { executeDQL, executeDataviewJS } from '../../builder/plugins/dataview'
import { renderColumns } from '../../builder/plugins/columns'
import { renderCallouts } from '../../builder/plugins/callouts'
import { applyObsidianCompat } from '../../builder/plugins/obsidian-compat'
import { renderMarkdown } from '../../builder/markdown'
import type { PageMeta } from '../../builder/types'

// Reproduz a composição do `makeRenderBody` do pipeline: o processamento de
// dataview roda DENTRO da recursão (antes de columns/callouts), de modo que
// blocos ```dataview / ```dataviewjs aninhados em callouts/columns — que só
// perdem o prefixo `> ` (ou as cercas de coluna) após o desempacotamento —
// também sejam renderizados em vez de sobreviverem como código bruto.

function makePage(overrides: Partial<PageMeta> & { path: string; title: string }): PageMeta {
  return {
    html: '',
    outlinks: [],
    tags: [],
    css: '',
    frontmatter: overrides.frontmatter ?? {},
    allFields: overrides.allFields ?? overrides.frontmatter ?? {},
    ...overrides,
  }
}

const stubs: PageMeta[] = [
  makePage({ path: 'Nacoes/Ksarshantallas', title: 'Ksarshantallas', frontmatter: { Tags: ['Nação'] }, tags: ['Nação'] }),
  makePage({ path: 'Nacoes/Outra', title: 'Outra', frontmatter: { Tags: ['Nação'] }, tags: ['Nação'] }),
]
const current = stubs[0]
const noopResolve = (p: string) => p

// Mesma ordem de passos do pipeline real (dataview PRIMEIRO, recursivo).
function makeRenderBody(css: string[]) {
  async function renderBody(md: string): Promise<string> {
    md = md.replace(/^```dataviewjs[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm, (_, code) => {
      const { html, css: cssText } = executeDataviewJS(code, stubs, current, 'myvault', noopResolve)
      if (cssText) css.push(cssText)
      return html
    })
    md = md.replace(/^```dataview[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm, (_, query) =>
      executeDQL(query.trim(), stubs, 'myvault'),
    )
    md = await renderColumns(md, renderBody)
    md = await renderCallouts(md, renderBody)
    md = applyObsidianCompat(md)
    md = await renderMarkdown(md)
    return md
  }
  return renderBody
}

describe('dataview aninhado (fix do pipeline)', () => {
  it('um bloco ```dataview dentro de um callout renderiza .dataview-result, não código bruto', async () => {
    const css: string[] = []
    const renderBody = makeRenderBody(css)
    const md = [
      '> [!info]+ Páginas relacionadas',
      '> ```dataview',
      '> TABLE Tags FROM "Nacoes"',
      '> ```',
    ].join('\n')
    const html = await renderBody(md)
    expect(html).toContain('class="vault-callout"')
    expect(html).toContain('class="dataview-result"')
    expect(html).toContain('data-type="table"')
    // Não deve sobrar a query bruta dentro de um <pre>/<code>.
    expect(html).not.toMatch(/<pre|<code/)
    expect(html).not.toContain('TABLE Tags FROM')
  })

  it('um bloco ```dataview dentro de uma coluna renderiza .dataview-result', async () => {
    const css: string[] = []
    const renderBody = makeRenderBody(css)
    const md = [
      '````col',
      '```col-md',
      'flexGrow=1',
      '===',
      '```dataview',
      'TABLE Tags FROM "Nacoes"',
      '```',
      '```',
      '````',
    ].join('\n')
    const html = await renderBody(md)
    expect(html).toContain('class="vault-columns"')
    expect(html).toContain('class="dataview-result"')
    expect(html).not.toContain('TABLE Tags FROM')
  })

  it('dataview de topo continua renderizando (sem regressão)', async () => {
    const css: string[] = []
    const renderBody = makeRenderBody(css)
    const md = ['```dataview', 'TABLE Tags FROM "Nacoes"', '```'].join('\n')
    const html = await renderBody(md)
    expect(html).toContain('class="dataview-result"')
    expect(html).not.toContain('TABLE Tags FROM')
  })

  it('dataviewjs aninhado em callout captura CSS no array de contexto', async () => {
    const css: string[] = []
    const renderBody = makeRenderBody(css)
    const md = [
      '> [!info]+ Galeria',
      '> ```dataviewjs',
      '> const s = document.createElement("style")',
      '> s.textContent = ".x{color:red}"',
      '> document.head.appendChild(s)',
      '> dv.paragraph("oi")',
      '> ```',
    ].join('\n')
    const html = await renderBody(md)
    expect(html).toContain('class="vault-callout"')
    expect(html).toContain('oi')
    expect(css.join('\n')).toContain('.x{color:red}')
  })
})
