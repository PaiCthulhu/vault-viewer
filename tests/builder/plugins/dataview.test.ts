import { describe, it, expect } from 'vitest'
import { executeDQL, executeDataviewJS } from '../../../builder/plugins/dataview'
import type { PageMeta } from '../../../builder/types'

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

const pages: PageMeta[] = [
  makePage({ path: 'Exemplares/Alfa', title: 'Alfa', frontmatter: { Tags: ['Exemplar'], Patamar: 'Ápice' }, tags: ['Exemplar'] }),
  makePage({ path: 'Exemplares/Sigma', title: 'Sigma', frontmatter: { Tags: ['Exemplar'], Patamar: 'Alto' }, tags: ['Exemplar'] }),
  makePage({ path: 'Ensaios/Gama', title: 'Gama', frontmatter: { Tags: ['Ensaio'], Patamar: 'Baixo' }, tags: ['Ensaio'] }),
]
const current = pages[0]

const noopResolve = (p: string) => p

describe('executeDQL', () => {
  it('TABLE retorna div.dataview-result com data-type=table', () => {
    const query = 'TABLE Patamar FROM "Exemplares"'
    const result = executeDQL(query, pages, 'myvault')
    expect(result).toContain('class="dataview-result"')
    expect(result).toContain('data-type="table"')
  })

  it('TABLE FROM filtra por pasta', () => {
    const query = 'TABLE Patamar FROM "Exemplares"'
    const result = executeDQL(query, pages, 'myvault')
    // O dataset codificado deve conter Alfa e Sigma, mas não Gama
    const encoded = result.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))
    expect(decoded).toHaveLength(2)
    expect(decoded.map((p: PageMeta) => p.title)).toContain('Alfa')
    expect(decoded.map((p: PageMeta) => p.title)).not.toContain('Gama')
  })

  it('WHERE contains() filtra corretamente', () => {
    const query = 'TABLE Patamar FROM "Exemplares" WHERE contains(Tags, "Exemplar")'
    const result = executeDQL(query, pages, 'myvault')
    const encoded = result.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))
    expect(decoded.every((p: PageMeta) => (p.tags as string[]).includes('Exemplar'))).toBe(true)
  })

  it('data-columns contém as colunas da query', () => {
    const query = 'TABLE Patamar AS "Escalão", Tags FROM "Exemplares"'
    const result = executeDQL(query, pages, 'myvault')
    const encoded = result.match(/data-columns="([^"]+)"/)?.[1] ?? ''
    const cols = JSON.parse(decodeURIComponent(encoded))
    expect(cols).toContain('Escalão')
    expect(cols).toContain('Tags')
  })

  it('LIST retorna div.dataview-result com data-type=list', () => {
    const result = executeDQL('LIST FROM "Exemplares"', pages, 'myvault')
    expect(result).toContain('data-type="list"')
  })
})

describe('executeDataviewJS', () => {
  it('dv.table() produz placeholder .dataview-result interativo', async () => {
    const code = `dv.table(["Nome", "Patamar"], dv.pages().map(p => [p.file.name, p.Patamar]))`
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('class="dataview-result"')
    expect(html).toContain('data-type="table"')
    // Colunas codificadas em data-columns
    const colsEnc = html.match(/data-columns="([^"]+)"/)?.[1] ?? ''
    const cols = JSON.parse(decodeURIComponent(colsEnc))
    expect(cols).toEqual(['Nome', 'Patamar'])
    // Linhas codificadas em base64 dentro de data-result
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(rows.some((r: string[]) => r[0] === 'Alfa')).toBe(true)
  })

  it('dv.pages() filtra por pasta', async () => {
    const code = `
      const ps = dv.pages('"Exemplares"')
      dv.table(["N"], ps.map(p => [p.file.name]))
    `
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as string[][]
    const flat = rows.flat()
    expect(flat).toContain('Alfa')
    expect(flat).not.toContain('Gama')
  })

  it('dv.pages().where() filtra com predicado', async () => {
    const code = `
      const ps = dv.pages().where(p => p.Patamar === 'Ápice')
      dv.list(ps.map(p => p.file.name))
    `
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(items).toContain('Alfa')
    expect(items).not.toContain('Sigma')
  })

  it('dv.list() produz placeholder .dataview-result interativo', async () => {
    const code = `dv.list(["Alpha", "Beta"])`
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('class="dataview-result"')
    expect(html).toContain('data-type="list"')
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(items).toEqual(['Alpha', 'Beta'])
  })

  it('dv.current() retorna dados da página atual', async () => {
    const code = `dv.paragraph(dv.current().file.name)`
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('Alfa')
  })

  it('captura CSS injetado via document.createElement("style")', async () => {
    const code = `
      const s = document.createElement('style')
      s.innerHTML = '.foo { color: red }'
      document.head.appendChild(s)
    `
    const { css } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(css).toContain('.foo { color: red }')
  })

  it('retorna div.dataview-error em caso de erro de script', async () => {
    const code = `throw new Error("teste")`
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('dataview-error')
  })

  it('.array() retorna um array JS puro (sem métodos DvArray)', async () => {
    const code = `
      const out = []
      const arr = dv.pages('"Exemplares"').where(p => p.Patamar === 'Ápice').array()
      out.push('isArray=' + Array.isArray(arr))
      out.push('len=' + arr.length)
      out.push('hasWhere=' + (typeof arr.where))
      out.push('name=' + arr[0].file.name)
      dv.paragraph(out.join('|'))
    `
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('isArray=true')
    expect(html).toContain('len=1')
    expect(html).toContain('hasWhere=undefined')
    expect(html).toContain('name=Alfa')
  })

  it('.values é um alias para o array plano', async () => {
    const code = `
      const v = dv.pages('"Exemplares"').values
      dv.paragraph('isArray=' + Array.isArray(v) + '|len=' + v.length)
    `
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('isArray=true')
    expect(html).toContain('len=2')
  })

  it('p.file.folder: aninhado e top-level; p.file.ext = md', async () => {
    const localPages = [
      ...pages,
      makePage({ path: 'TopLevel', title: 'TopLevel', frontmatter: {} }),
    ]
    const code = `
      const lines = dv.pages().map(p => p.file.name + '=>' + p.file.folder + ':' + p.file.ext)
      dv.list(lines)
    `
    const { html } = await executeDataviewJS(code, localPages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(items).toContain('Alfa=>Exemplares:md')
    expect(items).toContain('TopLevel=>:md')
  })

  it('reescreve href de anchors internal-link (caminho cru -> /vault/)', async () => {
    const code = `
      const card = dv.container.createEl('div', { cls: 'dv-card' })
      card.createEl('a', {
        cls: 'dv-card-name internal-link',
        text: 'Lambda',
        attr: { 'data-href': 'Ensaios/Subpasta/Lambda', href: 'Ensaios/Subpasta/Lambda' },
      })
    `
    const { html } = await executeDataviewJS(code, pages, current, 'my-vault', noopResolve)
    expect(html).toContain('href="/vault/my-vault/Ensaios/Subpasta/Lambda"')
    // The standalone href is rewritten (data-href may stay raw, which is fine).
    expect(html).not.toMatch(/(\s)href="Ensaios\/Subpasta\/Lambda"/)
  })

  it('decodifica entidades HTML no href antes de codificar a URL', async () => {
    // O serializador de El escapa `&` -> `&amp;` no valor do atributo. O rewrite
    // deve decodificar a entidade antes de encodeURIComponent, produzindo
    // `%26%20` (& seguido de espaço), NÃO `%26amp%3B`.
    const code = `
      const card = dv.container.createEl('div', { cls: 'dv-card' })
      card.createEl('a', {
        cls: 'internal-link',
        text: 'Nota',
        attr: { href: 'Pasta & Cia/Seção Ação/Nota Exemplo' },
      })
    `
    const { html } = await executeDataviewJS(code, pages, current, 'my-vault', noopResolve)
    expect(html).toContain(
      'href="/vault/my-vault/Pasta%20%26%20Cia/Se%C3%A7%C3%A3o%20A%C3%A7%C3%A3o/Nota%20Exemplo"',
    )
    expect(html).not.toContain('%26amp%3B')
  })

  it('não mexe em hrefs já absolutos ou http em internal-link', async () => {
    const code = `
      const c = dv.container.createEl('div', { cls: 'dv-card' })
      c.createEl('a', { cls: 'internal-link', text: 'A', attr: { href: '/vault/x/Y' } })
      c.createEl('a', { cls: 'internal-link', text: 'B', attr: { href: 'https://example.com' } })
    `
    const { html } = await executeDataviewJS(code, pages, current, 'my-vault', noopResolve)
    expect(html).toContain('href="/vault/x/Y"')
    expect(html).toContain('href="https://example.com"')
  })

  it('dv.el() retorna elemento mutável (empty/createEl) refletido no output', async () => {
    const code = `
      const gallery = dv.el('div', '', { cls: 'dv-gallery' })
      gallery.empty()
      const card = gallery.createEl('div', { cls: 'dv-card' })
      card.createEl('span', { text: 'oi' })
    `
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('class="dv-gallery"')
    expect(html).toContain('class="dv-card"')
    expect(html).toContain('<span>oi</span>')
  })

  it('não reescreve anchors sem classe internal-link', async () => {
    const code = `
      const c = dv.container.createEl('div')
      c.createEl('a', { cls: 'outra-classe', text: 'A', attr: { href: 'Raw/Path' } })
    `
    const { html } = await executeDataviewJS(code, pages, current, 'my-vault', noopResolve)
    expect(html).toContain('href="Raw/Path"')
  })

  it('dv.table reescreve internal-links nas células ANTES do base64', async () => {
    // Célula contendo um <a class="internal-link"> com href cru de vault. O href
    // deve ser reescrito para /vault/... DENTRO do payload base64 (o rewrite final
    // de output não cobre o conteúdo base64).
    const code = `
      const link = '<a class="internal-link" href="Ensaios/Subpasta/Lambda">Lambda</a>'
      dv.table(["Lugar"], [[link]])
    `
    const { html } = await executeDataviewJS(code, pages, current, 'my-vault', noopResolve)
    expect(html).toContain('class="dataview-result"')
    expect(html).toContain('data-type="table"')
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(rows[0][0]).toContain('href="/vault/my-vault/Ensaios/Subpasta/Lambda"')
    expect(rows[0][0]).not.toMatch(/href="Ensaios\/Subpasta\/Lambda"/)
  })

  it('dv.table normaliza células de array via renderCell', async () => {
    const code = `dv.table(["Tags"], [[["a", "b", "c"]]])`
    const { html } = await executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(rows[0][0]).toBe('a, b, c')
  })
})

describe('executeDataviewJS — data-props em .dv-card', () => {
  const cardPages: PageMeta[] = [
    makePage({
      path: 'Exemplares/Alfa',
      title: 'Alfa',
      tags: ['Exemplar', 'Ícone'],
      frontmatter: {
        Agrupamento: 'Primeiro Grupo',
        Patamar: 'Ápice',
        Feição: ['[[Gama]]'],
        Correlatos: ['[[Exemplares/Sigma|Sigma, o Segundo]]'],
        cover: 'Midia/alfa-banner.png',
        ID: 'abc-123',
        Created: '2020-01-01',
        URL: 'https://example.com/alfa',
        Notas: '',
      },
    }),
    makePage({
      path: 'Exemplares/Sigma',
      title: 'Sigma',
      tags: ['Exemplar'],
      frontmatter: {
        Agrupamento: 'Primeiro Grupo',
        Patamar: 'Alto',
        cover: 'Midia/sigma.png',
      },
    }),
  ]

  // Builds two .dv-card elements with internal-link anchors pointing at the two
  // pages above via data-href (raw vault paths).
  const GALLERY = `
    const gallery = dv.container.createEl("div", { cls: "dv-gallery" });
    for (const page of dv.pages('"Exemplares"')) {
      const card = gallery.createEl("div", { cls: "dv-card" });
      const body = card.createEl("div", { cls: "dv-card-body" });
      body.createEl("a", {
        cls: "dv-card-name internal-link",
        text: page.file.name,
        attr: { "data-href": page.file.path, href: page.file.path },
      });
    }
  `

  function decodeProps(html: string): Record<string, string[]>[] {
    const matches = [...html.matchAll(/data-props="([^"]+)"/g)]
    return matches.map(m => JSON.parse(decodeURIComponent(m[1])))
  }

  it('estampa data-props com chaves incluídas, normalizadas e Tags', async () => {
    const { html } = await executeDataviewJS(GALLERY, cardPages, cardPages[0], 'my-vault', noopResolve)
    const props = decodeProps(html)
    expect(props).toHaveLength(2)

    const alfa = props.find(p => p.Patamar?.[0] === 'Ápice')!
    expect(alfa).toBeDefined()
    expect(alfa.Agrupamento).toEqual(['Primeiro Grupo'])
    expect(alfa.Patamar).toEqual(['Ápice'])
    // Wikilink simples -> último segmento
    expect(alfa.Feição).toEqual(['Gama'])
    // Wikilink com alias -> alias
    expect(alfa.Correlatos).toEqual(['Sigma, o Segundo'])
    // Tags vêm de page.tags
    expect(alfa.Tags).toEqual(['Exemplar', 'Ícone'])
  })

  it('exclui chaves de cover/ID/Created/URL e strings vazias', async () => {
    const { html } = await executeDataviewJS(GALLERY, cardPages, cardPages[0], 'my-vault', noopResolve)
    const alfa = decodeProps(html).find(p => p.Patamar?.[0] === 'Ápice')!
    expect(alfa.cover).toBeUndefined()
    expect(alfa.ID).toBeUndefined()
    expect(alfa.Created).toBeUndefined()
    expect(alfa.URL).toBeUndefined()
    expect(alfa.Notas).toBeUndefined() // string vazia ignorada
  })

  it('cartões em document.body também são estampados', async () => {
    const code = `
      const gallery = document.body.createEl("div", { cls: "dv-gallery" });
      const card = gallery.createEl("div", { cls: "dv-card" });
      card.createEl("a", {
        cls: "internal-link",
        text: "Alfa",
        attr: { "data-href": "Exemplares/Alfa" },
      });
    `
    const { html } = await executeDataviewJS(code, cardPages, cardPages[0], 'my-vault', noopResolve)
    const props = decodeProps(html)
    expect(props).toHaveLength(1)
    expect(props[0].Patamar).toEqual(['Ápice'])
  })

  it('usa o data-href cru (não o href reescrito) para resolver a página', async () => {
    // Mesmo após rewriteInternalLinks alterar href, data-props deve ter sido
    // resolvido pelo caminho cru e estar presente.
    const { html } = await executeDataviewJS(GALLERY, cardPages, cardPages[0], 'my-vault', noopResolve)
    expect(html).toContain('href="/vault/my-vault/Exemplares/Alfa"')
    expect(html).toContain('data-props=')
  })

  it('cartão sem página correspondente é ignorado silenciosamente', async () => {
    const code = `
      const card = dv.container.createEl("div", { cls: "dv-card" });
      card.createEl("a", {
        cls: "internal-link",
        text: "Inexistente",
        attr: { "data-href": "Nao/Existe" },
      });
    `
    const { html } = await executeDataviewJS(code, cardPages, cardPages[0], 'my-vault', noopResolve)
    expect(html).toContain('class="dv-card"')
    expect(html).not.toContain('data-props=')
  })
})

const GALLERY_SCRIPT = `
const STYLE_ID = "dv-fotos-style";
if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = \`
        .dv-fotos { display: grid; grid-template-columns: repeat(3, 1fr); }
        .dv-fotos-card { padding: 4px; background: var(--background-secondary); }
    \`;
    document.head.appendChild(style);
}

const page = dv.current();
const fotos = page["Fotos"] ?? [];
const grid = dv.container.createEl("div", { cls: "dv-fotos" });

for (const foto of fotos) {
    const alvo = typeof foto === "string" ? foto : foto?.path;
    if (typeof alvo !== "string") continue;
    const file = app.metadataCache.getFirstLinkpathDest(alvo, page.file.path);
    if (!file) continue;
    const card = grid.createEl("div", { cls: "dv-fotos-card" });
    card.createEl("img", { attr: { src: app.vault.adapter.getResourcePath(file.path), alt: "" } });
}
`

describe('executeDataviewJS — galeria de imagens inline', () => {
  const galleryPage = makePage({
    path: 'Exemplares/Theta',
    title: 'Theta',
    frontmatter: {
      Fotos: ['[[Midia/Fotos/X_1.png]]', '[[Midia/Fotos/X_2.png]]'],
    },
  })
  const galleryPages = [galleryPage]

  it('renderiza duas imagens com src resolvido e classe da galeria', async () => {
    const resolved: string[] = []
    const resolveImage = (p: string) => {
      resolved.push(p)
      return `/vault-assets/my-vault/${p}`
    }
    const { html, css } = await executeDataviewJS(
      GALLERY_SCRIPT,
      galleryPages,
      galleryPage,
      'my-vault',
      resolveImage,
    )

    // Duas imagens
    const imgMatches = html.match(/<img/g) ?? []
    expect(imgMatches).toHaveLength(2)
    // Classe da galeria presente
    expect(html).toContain('dv-fotos')
    expect(html).toContain('dv-fotos-card')
    // src resolvido (sem brackets de wikilink)
    expect(html).toContain('src="/vault-assets/my-vault/Midia/Fotos/X_1.png"')
    expect(html).toContain('src="/vault-assets/my-vault/Midia/Fotos/X_2.png"')
    // resolveImage chamado com os caminhos limpos
    expect(resolved).toContain('Midia/Fotos/X_1.png')
    expect(resolved).toContain('Midia/Fotos/X_2.png')
    // img é void element: sem </img>
    expect(html).not.toContain('</img>')
    // CSS capturado
    expect(css).toContain('.dv-fotos')
    expect(css).toContain('--background-secondary')
  })

  it('dedup: getElementById impede injeção dupla de CSS quando o script roda duas vezes', async () => {
    const resolveImage = (p: string) => `/vault-assets/my-vault/${p}`
    // Roda o mesmo script duas vezes no MESMO contexto (mesma página).
    // Cada execução é envolvida em um bloco para isolar as declarações `const`,
    // mas o estado de `document` (head/getElementById) é compartilhado.
    const doubled = `{${GALLERY_SCRIPT}}\n{${GALLERY_SCRIPT}}`
    const { css } = await executeDataviewJS(
      doubled,
      galleryPages,
      galleryPage,
      'my-vault',
      resolveImage,
    )
    // O guard de getElementById deve impedir a segunda injeção do <style>
    const occurrences = css.split('.dv-fotos-card').length - 1
    expect(occurrences).toBe(1)
  })
})
