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
  makePage({ path: 'Personagens/Aldor', title: 'Aldor', frontmatter: { Tags: ['Personagem'], Tier: 'Lendário' }, tags: ['Personagem'] }),
  makePage({ path: 'Personagens/Ragnar', title: 'Ragnar', frontmatter: { Tags: ['Personagem'], Tier: 'Épico' }, tags: ['Personagem'] }),
  makePage({ path: 'Magia/Magus', title: 'Magus', frontmatter: { Tags: ['Conceito'], Tier: 'Raro' }, tags: ['Conceito'] }),
]
const current = pages[0]

const noopResolve = (p: string) => p

describe('executeDQL', () => {
  it('TABLE retorna div.dataview-result com data-type=table', () => {
    const query = 'TABLE Tier FROM "Personagens"'
    const result = executeDQL(query, pages, 'myvault')
    expect(result).toContain('class="dataview-result"')
    expect(result).toContain('data-type="table"')
  })

  it('TABLE FROM filtra por pasta', () => {
    const query = 'TABLE Tier FROM "Personagens"'
    const result = executeDQL(query, pages, 'myvault')
    // O dataset codificado deve conter Aldor e Ragnar, mas não Magus
    const encoded = result.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))
    expect(decoded).toHaveLength(2)
    expect(decoded.map((p: PageMeta) => p.title)).toContain('Aldor')
    expect(decoded.map((p: PageMeta) => p.title)).not.toContain('Magus')
  })

  it('WHERE contains() filtra corretamente', () => {
    const query = 'TABLE Tier FROM "Personagens" WHERE contains(Tags, "Personagem")'
    const result = executeDQL(query, pages, 'myvault')
    const encoded = result.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))
    expect(decoded.every((p: PageMeta) => (p.tags as string[]).includes('Personagem'))).toBe(true)
  })

  it('data-columns contém as colunas da query', () => {
    const query = 'TABLE Tier AS "Escalão", Tags FROM "Personagens"'
    const result = executeDQL(query, pages, 'myvault')
    const encoded = result.match(/data-columns="([^"]+)"/)?.[1] ?? ''
    const cols = JSON.parse(decodeURIComponent(encoded))
    expect(cols).toContain('Escalão')
    expect(cols).toContain('Tags')
  })

  it('LIST retorna div.dataview-result com data-type=list', () => {
    const result = executeDQL('LIST FROM "Personagens"', pages, 'myvault')
    expect(result).toContain('data-type="list"')
  })
})

describe('executeDataviewJS', () => {
  it('dv.table() produz placeholder .dataview-result interativo', () => {
    const code = `dv.table(["Nome", "Tier"], dv.pages().map(p => [p.file.name, p.Tier]))`
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('class="dataview-result"')
    expect(html).toContain('data-type="table"')
    // Colunas codificadas em data-columns
    const colsEnc = html.match(/data-columns="([^"]+)"/)?.[1] ?? ''
    const cols = JSON.parse(decodeURIComponent(colsEnc))
    expect(cols).toEqual(['Nome', 'Tier'])
    // Linhas codificadas em base64 dentro de data-result
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(rows.some((r: string[]) => r[0] === 'Aldor')).toBe(true)
  })

  it('dv.pages() filtra por pasta', () => {
    const code = `
      const ps = dv.pages('"Personagens"')
      dv.table(["N"], ps.map(p => [p.file.name]))
    `
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as string[][]
    const flat = rows.flat()
    expect(flat).toContain('Aldor')
    expect(flat).not.toContain('Magus')
  })

  it('dv.pages().where() filtra com predicado', () => {
    const code = `
      const ps = dv.pages().where(p => p.Tier === 'Lendário')
      dv.list(ps.map(p => p.file.name))
    `
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(items).toContain('Aldor')
    expect(items).not.toContain('Ragnar')
  })

  it('dv.list() produz placeholder .dataview-result interativo', () => {
    const code = `dv.list(["Alpha", "Beta"])`
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('class="dataview-result"')
    expect(html).toContain('data-type="list"')
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(items).toEqual(['Alpha', 'Beta'])
  })

  it('dv.current() retorna dados da página atual', () => {
    const code = `dv.paragraph(dv.current().file.name)`
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('Aldor')
  })

  it('captura CSS injetado via document.createElement("style")', () => {
    const code = `
      const s = document.createElement('style')
      s.innerHTML = '.foo { color: red }'
      document.head.appendChild(s)
    `
    const { css } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(css).toContain('.foo { color: red }')
  })

  it('retorna div.dataview-error em caso de erro de script', () => {
    const code = `throw new Error("teste")`
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('dataview-error')
  })

  it('.array() retorna um array JS puro (sem métodos DvArray)', () => {
    const code = `
      const out = []
      const arr = dv.pages('"Personagens"').where(p => p.Tier === 'Lendário').array()
      out.push('isArray=' + Array.isArray(arr))
      out.push('len=' + arr.length)
      out.push('hasWhere=' + (typeof arr.where))
      out.push('name=' + arr[0].file.name)
      dv.paragraph(out.join('|'))
    `
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('isArray=true')
    expect(html).toContain('len=1')
    expect(html).toContain('hasWhere=undefined')
    expect(html).toContain('name=Aldor')
  })

  it('.values é um alias para o array plano', () => {
    const code = `
      const v = dv.pages('"Personagens"').values
      dv.paragraph('isArray=' + Array.isArray(v) + '|len=' + v.length)
    `
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('isArray=true')
    expect(html).toContain('len=2')
  })

  it('p.file.folder: aninhado e top-level; p.file.ext = md', () => {
    const localPages = [
      ...pages,
      makePage({ path: 'TopLevel', title: 'TopLevel', frontmatter: {} }),
    ]
    const code = `
      const lines = dv.pages().map(p => p.file.name + '=>' + p.file.folder + ':' + p.file.ext)
      dv.list(lines)
    `
    const { html } = executeDataviewJS(code, localPages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const items = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(items).toContain('Aldor=>Personagens:md')
    expect(items).toContain('TopLevel=>:md')
  })

  it('reescreve href de anchors internal-link (caminho cru -> /vault/)', () => {
    const code = `
      const card = dv.container.createEl('div', { cls: 'dv-card' })
      card.createEl('a', {
        cls: 'dv-card-name internal-link',
        text: 'Donner',
        attr: { 'data-href': 'Cosmologia/Astros/Donner', href: 'Cosmologia/Astros/Donner' },
      })
    `
    const { html } = executeDataviewJS(code, pages, current, 'drachegotter', noopResolve)
    expect(html).toContain('href="/vault/drachegotter/Cosmologia/Astros/Donner"')
    // The standalone href is rewritten (data-href may stay raw, which is fine).
    expect(html).not.toMatch(/(\s)href="Cosmologia\/Astros\/Donner"/)
  })

  it('decodifica entidades HTML no href antes de codificar a URL', () => {
    // O serializador de El escapa `&` -> `&amp;` no valor do atributo. O rewrite
    // deve decodificar a entidade antes de encodeURIComponent, produzindo
    // `%26%20` (& seguido de espaço), NÃO `%26amp%3B`.
    const code = `
      const card = dv.container.createEl('div', { cls: 'dv-card' })
      card.createEl('a', {
        cls: 'internal-link',
        text: 'Ntoto',
        attr: { href: 'Personalidades & Facções/Nações/Ntoto Ileri' },
      })
    `
    const { html } = executeDataviewJS(code, pages, current, 'drachegotter', noopResolve)
    expect(html).toContain(
      'href="/vault/drachegotter/Personalidades%20%26%20Fac%C3%A7%C3%B5es/Na%C3%A7%C3%B5es/Ntoto%20Ileri"',
    )
    expect(html).not.toContain('%26amp%3B')
  })

  it('não mexe em hrefs já absolutos ou http em internal-link', () => {
    const code = `
      const c = dv.container.createEl('div', { cls: 'dv-card' })
      c.createEl('a', { cls: 'internal-link', text: 'A', attr: { href: '/vault/x/Y' } })
      c.createEl('a', { cls: 'internal-link', text: 'B', attr: { href: 'https://example.com' } })
    `
    const { html } = executeDataviewJS(code, pages, current, 'drachegotter', noopResolve)
    expect(html).toContain('href="/vault/x/Y"')
    expect(html).toContain('href="https://example.com"')
  })

  it('dv.el() retorna elemento mutável (empty/createEl) refletido no output', () => {
    const code = `
      const gallery = dv.el('div', '', { cls: 'dv-gallery' })
      gallery.empty()
      const card = gallery.createEl('div', { cls: 'dv-card' })
      card.createEl('span', { text: 'oi' })
    `
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    expect(html).toContain('class="dv-gallery"')
    expect(html).toContain('class="dv-card"')
    expect(html).toContain('<span>oi</span>')
  })

  it('não reescreve anchors sem classe internal-link', () => {
    const code = `
      const c = dv.container.createEl('div')
      c.createEl('a', { cls: 'outra-classe', text: 'A', attr: { href: 'Raw/Path' } })
    `
    const { html } = executeDataviewJS(code, pages, current, 'drachegotter', noopResolve)
    expect(html).toContain('href="Raw/Path"')
  })

  it('dv.table reescreve internal-links nas células ANTES do base64', () => {
    // Célula contendo um <a class="internal-link"> com href cru de vault. O href
    // deve ser reescrito para /vault/... DENTRO do payload base64 (o rewrite final
    // de output não cobre o conteúdo base64).
    const code = `
      const link = '<a class="internal-link" href="Cosmologia/Astros/Donner">Donner</a>'
      dv.table(["Astro"], [[link]])
    `
    const { html } = executeDataviewJS(code, pages, current, 'drachegotter', noopResolve)
    expect(html).toContain('class="dataview-result"')
    expect(html).toContain('data-type="table"')
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(rows[0][0]).toContain('href="/vault/drachegotter/Cosmologia/Astros/Donner"')
    expect(rows[0][0]).not.toMatch(/href="Cosmologia\/Astros\/Donner"/)
  })

  it('dv.table normaliza células de array via renderCell', () => {
    const code = `dv.table(["Tags"], [[["a", "b", "c"]]])`
    const { html } = executeDataviewJS(code, pages, current, 'myvault', noopResolve)
    const b64 = html.match(/data-result="([^"]+)"/)?.[1] ?? ''
    const rows = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    expect(rows[0][0]).toBe('a, b, c')
  })
})

describe('executeDataviewJS — data-props em .dv-card', () => {
  const cardPages: PageMeta[] = [
    makePage({
      path: 'Personalidades/Aldor',
      title: 'Aldor',
      tags: ['Personagem', 'Herói'],
      frontmatter: {
        Categoria: 'Personalidades Importantes',
        Tier: 'Lendário',
        Raça: ['[[Humano]]'],
        Aliados: ['[[Personalidades/Ragnar|Ragnar, o Bravo]]'],
        cover: 'Imagens/aldor-banner.png',
        ID: 'abc-123',
        Created: '2020-01-01',
        URL: 'https://example.com/aldor',
        Notas: '',
      },
    }),
    makePage({
      path: 'Personalidades/Ragnar',
      title: 'Ragnar',
      tags: ['Personagem'],
      frontmatter: {
        Categoria: 'Personalidades Importantes',
        Tier: 'Épico',
        cover: 'Imagens/ragnar.png',
      },
    }),
  ]

  // Builds two .dv-card elements with internal-link anchors pointing at the two
  // pages above via data-href (raw vault paths).
  const GALLERY = `
    const gallery = dv.container.createEl("div", { cls: "dv-gallery" });
    for (const page of dv.pages('"Personalidades"')) {
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

  it('estampa data-props com chaves incluídas, normalizadas e Tags', () => {
    const { html } = executeDataviewJS(GALLERY, cardPages, cardPages[0], 'drachegotter', noopResolve)
    const props = decodeProps(html)
    expect(props).toHaveLength(2)

    const aldor = props.find(p => p.Tier?.[0] === 'Lendário')!
    expect(aldor).toBeDefined()
    expect(aldor.Categoria).toEqual(['Personalidades Importantes'])
    expect(aldor.Tier).toEqual(['Lendário'])
    // Wikilink simples -> último segmento
    expect(aldor.Raça).toEqual(['Humano'])
    // Wikilink com alias -> alias
    expect(aldor.Aliados).toEqual(['Ragnar, o Bravo'])
    // Tags vêm de page.tags
    expect(aldor.Tags).toEqual(['Personagem', 'Herói'])
  })

  it('exclui chaves de cover/ID/Created/URL e strings vazias', () => {
    const { html } = executeDataviewJS(GALLERY, cardPages, cardPages[0], 'drachegotter', noopResolve)
    const aldor = decodeProps(html).find(p => p.Tier?.[0] === 'Lendário')!
    expect(aldor.cover).toBeUndefined()
    expect(aldor.ID).toBeUndefined()
    expect(aldor.Created).toBeUndefined()
    expect(aldor.URL).toBeUndefined()
    expect(aldor.Notas).toBeUndefined() // string vazia ignorada
  })

  it('cartões em document.body também são estampados', () => {
    const code = `
      const gallery = document.body.createEl("div", { cls: "dv-gallery" });
      const card = gallery.createEl("div", { cls: "dv-card" });
      card.createEl("a", {
        cls: "internal-link",
        text: "Aldor",
        attr: { "data-href": "Personalidades/Aldor" },
      });
    `
    const { html } = executeDataviewJS(code, cardPages, cardPages[0], 'drachegotter', noopResolve)
    const props = decodeProps(html)
    expect(props).toHaveLength(1)
    expect(props[0].Tier).toEqual(['Lendário'])
  })

  it('usa o data-href cru (não o href reescrito) para resolver a página', () => {
    // Mesmo após rewriteInternalLinks alterar href, data-props deve ter sido
    // resolvido pelo caminho cru e estar presente.
    const { html } = executeDataviewJS(GALLERY, cardPages, cardPages[0], 'drachegotter', noopResolve)
    expect(html).toContain('href="/vault/drachegotter/Personalidades/Aldor"')
    expect(html).toContain('data-props=')
  })

  it('cartão sem página correspondente é ignorado silenciosamente', () => {
    const code = `
      const card = dv.container.createEl("div", { cls: "dv-card" });
      card.createEl("a", {
        cls: "internal-link",
        text: "Inexistente",
        attr: { "data-href": "Nao/Existe" },
      });
    `
    const { html } = executeDataviewJS(code, cardPages, cardPages[0], 'drachegotter', noopResolve)
    expect(html).toContain('class="dv-card"')
    expect(html).not.toContain('data-props=')
  })
})

const GALLERY_SCRIPT = `
if (!document.getElementById("dv-inline-gallery-style")) {
    const s = document.createElement("style");
    s.id = "dv-inline-gallery-style";
    s.textContent = \`
        .dv-inline-gallery { display: flex; gap: 8px; }
        .dv-inline-gallery-card { border: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
    \`;
    document.head.appendChild(s);
}

const current = dv.current();
const images = current["Ilustração"] ?? [];
const gallery = dv.container.createEl("div", { cls: "dv-inline-gallery" });

for (const image of images) {
    const path = image?.path ?? image;
    const file = typeof path === "string"
        ? app.metadataCache.getFirstLinkpathDest(path, current.file.path)
        : null;
    if (!file) continue;

    const card = gallery.createEl("div", { cls: "dv-inline-gallery-card" });
    card.createEl("img", { attr: { src: app.vault.adapter.getResourcePath(file.path), alt: "" } });
}
`

describe('executeDataviewJS — galeria de imagens inline', () => {
  const galleryPage = makePage({
    path: 'Bestiário/Grandrak',
    title: 'Grandrak',
    frontmatter: {
      Ilustração: ['[[Imagens/Galerias/X_1.png]]', '[[Imagens/Galerias/X_2.png]]'],
    },
  })
  const galleryPages = [galleryPage]

  it('renderiza duas imagens com src resolvido e classe da galeria', () => {
    const resolved: string[] = []
    const resolveImage = (p: string) => {
      resolved.push(p)
      return `/vault-assets/drachegotter/${p}`
    }
    const { html, css } = executeDataviewJS(
      GALLERY_SCRIPT,
      galleryPages,
      galleryPage,
      'drachegotter',
      resolveImage,
    )

    // Duas imagens
    const imgMatches = html.match(/<img/g) ?? []
    expect(imgMatches).toHaveLength(2)
    // Classe da galeria presente
    expect(html).toContain('dv-inline-gallery')
    expect(html).toContain('dv-inline-gallery-card')
    // src resolvido (sem brackets de wikilink)
    expect(html).toContain('src="/vault-assets/drachegotter/Imagens/Galerias/X_1.png"')
    expect(html).toContain('src="/vault-assets/drachegotter/Imagens/Galerias/X_2.png"')
    // resolveImage chamado com os caminhos limpos
    expect(resolved).toContain('Imagens/Galerias/X_1.png')
    expect(resolved).toContain('Imagens/Galerias/X_2.png')
    // img é void element: sem </img>
    expect(html).not.toContain('</img>')
    // CSS capturado
    expect(css).toContain('.dv-inline-gallery')
    expect(css).toContain('--background-secondary')
  })

  it('dedup: getElementById impede injeção dupla de CSS quando o script roda duas vezes', () => {
    const resolveImage = (p: string) => `/vault-assets/drachegotter/${p}`
    // Roda o mesmo script duas vezes no MESMO contexto (mesma página).
    // Cada execução é envolvida em um bloco para isolar as declarações `const`,
    // mas o estado de `document` (head/getElementById) é compartilhado.
    const doubled = `{${GALLERY_SCRIPT}}\n{${GALLERY_SCRIPT}}`
    const { css } = executeDataviewJS(
      doubled,
      galleryPages,
      galleryPage,
      'drachegotter',
      resolveImage,
    )
    // O guard de getElementById deve impedir a segunda injeção do <style>
    const occurrences = css.split('.dv-inline-gallery-card').length - 1
    expect(occurrences).toBe(1)
  })
})
