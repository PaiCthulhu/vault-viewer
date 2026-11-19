import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { executeDataviewJS } from '../../../builder/plugins/dataview'
import type { PageMeta } from '../../../builder/types'

// Cobre o que as views do tipo `await dv.view("_views/cards", {...})` precisam
// do shim: await no bloco, dv.view, dv.io.load e o DOM que um renderizador
// compartilhado usa (SVG, <details open>, classList, propriedades refletidas).

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
  makePage({
    path: 'Pasta/Alfa',
    title: 'Alfa',
    frontmatter: { Nome: 'Alfa', Status: 'Pausado', Data: new Date('2024-03-15T00:00:00Z') },
  }),
  makePage({ path: 'Ensaios/Consulta', title: 'Consulta', frontmatter: {} }),
]
const current = pages[1]
const noopResolve = (p: string) => p

let root: string
let vault: string

function write(rel: string, content: string) {
  const full = path.join(vault, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-view-'))
  vault = path.join(root, 'vault')
  fs.mkdirSync(vault)
  fs.writeFileSync(path.join(root, 'segredo.txt'), 'NAO-PODE-VAZAR', 'utf-8')
  write(
    '_v/cards/view.js',
    `const cfg = JSON.parse(await dv.io.load("_v/dados.json"));
     dv.container.classList.add("raiz");
     const p = document.createElement("p");
     p.textContent = input.titulo + ":" + cfg.n;
     dv.container.appendChild(p);`,
  )
  write('_v/cards/view.css', '.raiz { color: red; }')
  write('_v/dados.json', '{"n": 3}')
  write('_v/simples.js', 'dv.paragraph("simples " + input)')
  write('_v/quebra/view.js', 'dv.paragraph("antes"); throw new Error("pum")')
  write('_v/quebra/view.css', '.quebra { color: blue; }')
  write('..pontos/x.txt', 'nome com pontos')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const run = (code: string, cur: PageMeta = current, timeoutMs?: number) =>
  executeDataviewJS(code, pages, cur, 'myvault', noopResolve, { vaultRoot: vault, timeoutMs })

describe('executeDataviewJS — await, dv.io.load e dv.view', () => {
  it('aceita await no topo do bloco', async () => {
    const { html } = await run(`const n = await Promise.resolve(41); dv.paragraph(String(n + 1))`)
    expect(html).not.toContain('dataview-error')
    expect(html).toContain('<p>42</p>')
  })

  it('dv.io.load devolve o texto de um arquivo do vault', async () => {
    const { html } = await run(`dv.paragraph(JSON.parse(await dv.io.load("_v/dados.json")).n)`)
    expect(html).toContain('<p>3</p>')
  })

  it('dv.io.load de arquivo inexistente devolve undefined', async () => {
    const { html } = await run(`dv.paragraph(String(await dv.io.load("_v/nao-existe.json")))`)
    expect(html).toContain('<p>undefined</p>')
  })

  it('dv.io.load trata caminho que sai do vault como inexistente', async () => {
    const abs = JSON.stringify(path.join(root, 'segredo.txt'))
    const { html } = await run(`
      dv.paragraph(String(await dv.io.load("../segredo.txt")));
      dv.paragraph(String(await dv.io.load("_v/../../segredo.txt")));
      dv.paragraph(String(await dv.io.load(${abs})));
    `)
    expect(html).toBe('<p>undefined</p><p>undefined</p><p>undefined</p>')
    expect(html).not.toContain('NAO-PODE-VAZAR')
  })

  it('dv.io.load aceita pasta cujo nome começa com ..', async () => {
    const { html } = await run(`dv.paragraph(await dv.io.load("..pontos/x.txt"))`)
    expect(html).toContain('<p>nome com pontos</p>')
  })

  it('dv.io.load sem await, com .then, termina antes da saída', async () => {
    const { html } = await run(`dv.io.load("_v/dados.json").then(t => dv.paragraph(JSON.parse(t).n))`)
    expect(html).toBe('<p>3</p>')
  })

  it('dv.view roda <pasta>/view.js com input e junta o view.css ao CSS da página', async () => {
    const { html, css } = await run(`await dv.view("_v/cards", { titulo: "Oi" })`)
    expect(html).toContain('<div class="raiz"><p>Oi:3</p></div>')
    expect(css).toContain('.raiz { color: red; }')
  })

  it('dv.view sem await termina antes da saída', async () => {
    const { html } = await run(`dv.view("_v/cards", { titulo: "Solto" })`)
    expect(html).toContain('<div class="raiz"><p>Solto:3</p></div>')
  })

  it('view que lança vira erro no lugar, o bloco segue e o CSS entra', async () => {
    const { html, css } = await run(`await dv.view("_v/quebra"); dv.paragraph("depois")`)
    expect(html).toContain('<p>antes</p>')
    expect(html).toContain('dataview-error')
    expect(html).toContain('pum')
    expect(html).toContain('<p>depois</p>')
    expect(css).toContain('.quebra { color: blue; }')
  })

  it('a mesma view chamada duas vezes põe o CSS uma vez só', async () => {
    const { css } = await run(`await dv.view("_v/cards", { titulo: "a" }); await dv.view("_v/cards", { titulo: "b" })`)
    expect(css.split('.raiz { color: red; }').length - 1).toBe(1)
  })

  it('promise que nunca resolve estoura o prazo e vira dataview-error', async () => {
    const t0 = Date.now()
    const { html } = await run(`await new Promise(() => {})`, current, 50)
    expect(html).toContain('dataview-error')
    expect(html).toContain('timed out')
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('dv.view aceita <nome>.js', async () => {
    const { html } = await run(`await dv.view("_v/simples", "x")`)
    expect(html).toContain('<p>simples x</p>')
  })

  it('dv.view sem arquivo vira dataview-error com o nome da view', async () => {
    const { html } = await run(`await dv.view("_v/sumiu", {})`)
    expect(html).toContain('dataview-error')
    expect(html).toContain('_v/sumiu')
  })
})

describe('executeDataviewJS — DOM de um renderizador compartilhado', () => {
  it('document.createElementNS gera SVG serializável', async () => {
    const { html } = await run(`
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 42 42");
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("class", "fatia");
      svg.appendChild(c);
      dv.container.appendChild(svg);
    `)
    expect(html).toContain('<svg viewBox="0 0 42 42"><circle class="fatia"></circle></svg>')
  })

  it('details.open vira atributo e classList.toggle respeita o force', async () => {
    const { html } = await run(`
      const a = document.createElement("details");
      a.open = true;
      a.classList.toggle("fechado", !a.open);
      const b = document.createElement("details");
      b.open = false;
      b.classList.toggle("fechado", !b.open);
      dv.container.appendChild(a);
      dv.container.appendChild(b);
    `)
    expect(html).toContain('<details open=""></details><details class="fechado"></details>')
  })

  it('propriedades refletidas (href, src, title, loading) viram atributo', async () => {
    const { html } = await run(`
      const a = document.createElement("a");
      a.className = "internal-link";
      a.href = "Pasta/Alfa";
      a.title = "dica";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = "capa.png";
      dv.container.appendChild(a);
      dv.container.appendChild(img);
    `)
    expect(html).toContain('href="/vault/myvault/Pasta/Alfa"')
    expect(html).toContain('title="dica"')
    expect(html).toContain('<img loading="lazy" src="capa.png">')
  })

  it('classe no dv.container embrulha a saída num div com essa classe', async () => {
    const { html } = await run(`dv.container.classList.add("minha-view"); dv.paragraph("oi")`)
    expect(html).toBe('<div class="minha-view"><p>oi</p></div>')
  })

  it('p.file.frontmatter traz o frontmatter cru, com datas que passam em instanceof Date', async () => {
    const { html } = await run(`
      const fm = dv.pages('"Pasta"').values[0].file.frontmatter;
      dv.paragraph(fm.Nome + "|" + (fm.Data instanceof Date) + "|" + fm.Data.toISOString().slice(0, 10));
    `)
    expect(html).toContain('<p>Alfa|true|2024-03-15</p>')
  })

  it('dv.currentFilePath é o caminho da nota atual', async () => {
    const { html } = await run(`dv.paragraph(dv.currentFilePath)`)
    expect(html).toContain('<p>Ensaios/Consulta</p>')
  })

  it('o arquivo de getFirstLinkpathDest tem basename e extension, como o TFile', async () => {
    const { html } = await run(`
      const f = app.metadataCache.getFirstLinkpathDest("Midia/Fotos/Capa 1.webp", "");
      dv.paragraph(f.name + "|" + f.basename + "|" + f.extension);
    `)
    expect(html).toContain('<p>Capa 1.webp|Capa 1|webp</p>')
  })

  it('URL existe no contexto', async () => {
    const { html } = await run(`dv.paragraph(new URL("https://www.exemplo.com/a").hostname)`)
    expect(html).toContain('<p>www.exemplo.com</p>')
  })

  // Contrato: o script roda no build, sem DOM vivo. Um renderizador que serve ao
  // Obsidian e ao viewer usa `typeof window` para não desenhar controles que só
  // funcionam com eventos (ex.: botões de reordenar e pílulas de filtro de uma galeria).
  it('não há window no contexto', async () => {
    const { html } = await run(`dv.paragraph(typeof window)`)
    expect(html).toContain('<p>undefined</p>')
  })
})
