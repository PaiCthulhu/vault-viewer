import { describe, it, expect } from 'vitest'
import { renderCallouts } from '../../../builder/plugins/callouts'
import { renderColumns } from '../../../builder/plugins/columns'
import { renderMarkdown } from '../../../builder/markdown'

// renderInner simples: apenas envolve em <p> para inspeção
const wrap = async (md: string) => `<p>${md.trim()}</p>`

describe('renderCallouts', () => {
  it('converte um callout básico em div.vault-callout', async () => {
    const md = `> [!note]+ Runas de Animancia
> Em seu braço direito fica suas runas.`
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('class="vault-callout"')
    expect(result).toContain('data-callout="note"')
    expect(result).toContain('Runas de Animancia')
    expect(result).toContain('class="vault-callout-content"')
    expect(result).toContain('Em seu braço direito')
  })

  it('usa o tipo capitalizado quando não há título', async () => {
    const md = `> [!warning]
> Cuidado.`
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('data-callout="warning"')
    expect(result).toContain('Warning')
  })

  it('marcador + produz <details open>', async () => {
    const md = `> [!note]+ Aberto
> Conteúdo.`
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('<details class="vault-callout" data-callout="note" open>')
    expect(result).toContain('<summary class="vault-callout-title">')
  })

  it('marcador - produz <details> sem open', async () => {
    const md = `> [!note]- Fechado
> Conteúdo.`
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('<details class="vault-callout" data-callout="note">')
    expect(result).not.toContain(' open>')
  })

  it('callout sem marcador produz <div> não-interativo', async () => {
    const md = `> [!note] Simples
> Conteúdo.`
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('<div class="vault-callout" data-callout="note">')
    expect(result).not.toContain('<details')
    expect(result).not.toContain('vault-callout-fold')
  })

  it('título com ## vira <h2 class="vault-callout-heading">', async () => {
    const md = `> [!note]+ ## Gestalt
> Conteúdo.`
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('<h2 class="vault-callout-heading">Gestalt</h2>')
  })

  it('inclui linha de continuação lazy no conteúdo', async () => {
    const md = `> [!note]+ Lazy
> Primeira linha do blockquote.
linha de continuação lazy sem prefixo.
> Terceira linha.`
    const inner = async (md: string) => `<p>${md}</p>`
    const result = await renderCallouts(md, inner)
    expect(result).toContain('linha de continuação lazy sem prefixo.')
    expect(result).toContain('Terceira linha.')
  })

  it('tipo userinput recebe ícone 💬', async () => {
    const md = `> [!userinput]
> Pergunta?`
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('data-callout="userinput"')
    expect(result).toContain('💬')
  })

  it('não altera blockquotes regulares sem [!type]', async () => {
    const md = `> Apenas uma citação normal.`
    const result = await renderCallouts(md, wrap)
    expect(result).not.toContain('vault-callout')
    expect(result).toContain('> Apenas uma citação normal.')
  })

  it('continuação lazy NÃO engole uma cerca de código que inicia um bloco', async () => {
    // Caso real (Elsiva): um callout dentro de uma coluna é seguido pela cerca
    // ``` que fecha o col-md. A linha da cerca vem logo após uma linha `>`, mas
    // como inicia um novo bloco ela deve ENCERRAR o callout, não ser engolida.
    const md = [
      '> [!note] 📌',
      '> **Info**',
      '> **Languages** Common, Elven',
      '```',
    ].join('\n')
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('class="vault-callout"')
    // A cerca permanece como linha de markdown fora do callout.
    expect(result).toContain('```')
    // Não foi absorvida no conteúdo do callout.
    expect(result).not.toContain('Languages</p>\n```')
  })

  it('continuação lazy para em heading e em linha em branco', async () => {
    const md = [
      '> [!note] T',
      '> corpo',
      '# Heading fora',
    ].join('\n')
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('class="vault-callout"')
    expect(result).toContain('# Heading fora')
  })

  it('insere linha em branco quando o callout é seguido por um heading colado', async () => {
    // Espelha o Fix de columns: o HTML do callout é um bloco HTML que engole as
    // linhas seguintes até uma linha em branco. Um `# Heading` colado deve render
    // como <h1>, não texto literal.
    const md = [
      '> [!note] T',
      '> corpo',
      '# Demografia',
    ].join('\n')
    const result = await renderCallouts(md, wrap)
    expect(result).toContain('class="vault-callout"')
    // Linha em branco entre o HTML do callout e o heading.
    expect(result).toMatch(/<\/div>\n\n# Demografia/)
    const html = await renderMarkdown(result)
    expect(html).toContain('<h1')
    expect(html).toContain('Demografia')
    expect(html).not.toContain('# Demografia')
  })

  it('nesting (i): callout dentro de col-md — columns extrai primeiro, depois callouts', async () => {
    // Simula a ordem do renderBody: renderColumns ANTES de renderCallouts, com
    // recursão que aplica renderCallouts no conteúdo interno das colunas.
    const renderInner = async (inner: string): Promise<string> => {
      const c = await renderCallouts(inner, wrap)
      return c
    }
    const md = [
      '````col',
      '```col-md',
      'flexGrow=1',
      '===',
      '> [!note] 📌',
      '> **Info**',
      '> **Languages** Common',
      '```',
      '```col-md',
      'flexGrow=1',
      '===',
      'segunda coluna',
      '```',
      '````',
    ].join('\n')
    // columns-first: a cerca de fechamento do primeiro col-md já delimita a
    // coluna ANTES de qualquer parsing de callout.
    const afterColumns = await renderColumns(md, renderInner)
    expect(afterColumns).toContain('class="vault-columns"')
    expect(afterColumns).toContain('class="vault-callout"')
    expect(afterColumns).toContain('segunda coluna')
    // Sem <pre> envolvendo as colunas (sem desbalanceamento de cercas).
    expect(afterColumns).not.toContain('<pre>')
  })

  it('não processa callouts dentro de cercas de código', async () => {
    // Caso real (Crônicas de Wilfred Triskian): a sintaxe de callout documentada
    // dentro de uma cerca ``` deve permanecer literal, não virar vault-callout.
    const md = [
      '```',
      '> [!userinput]',
      '> exemplo...',
      '```',
    ].join('\n')
    const result = await renderCallouts(md, wrap)
    expect(result).not.toContain('vault-callout')
    expect(result).toContain('> [!userinput]')
    expect(result).toContain('> exemplo...')
  })

  it('callout aninhado em blockquote comum vira vault-blockquote com details', async () => {
    // Caso real (Aldor/Ficha): blockquote comum cujo conteúdo interno tem um
    // callout mais profundo. Sem [!type] em depth 1, antes virava literal.
    const renderInner = async (md: string) => renderCallouts(md, wrap)
    const md = [
      '> some plain quote content',
      '> > [!note]+ **Reação**',
      '> > - **Martial Counterspell (Su)** → ...',
    ].join('\n')
    const result = await renderCallouts(md, renderInner)
    expect(result).toContain('<blockquote class="vault-blockquote">')
    expect(result).toContain('<details class="vault-callout"')
    expect(result).not.toContain('[!note]+')
  })

  it('blockquote comum sem nenhum callout permanece intocado', async () => {
    const md = [
      '> some plain quote content',
      '> second line of the quote',
    ].join('\n')
    const result = await renderCallouts(md, wrap)
    expect(result).not.toContain('vault-blockquote')
    expect(result).not.toContain('vault-callout')
    expect(result).toContain('> some plain quote content')
    expect(result).toContain('> second line of the quote')
  })

  it('nesting (ii): colunas dentro de um callout (linhas `> `-prefixadas)', async () => {
    // renderInner = columns + wrap (simula o renderBody recursivo)
    const renderInner = async (md: string) => renderColumns(md, wrap)

    const md = `> [!note]+ Com colunas
> Intro
> \`\`\`\`col
> \`\`\`col-md
> flexGrow=2.4
> ===
> Sol Rex
> \`\`\`
> \`\`\`col-md
> flexGrow=0.8
> textAlign=right
> ===
> Imagem
> \`\`\`
> \`\`\`\``
    const result = await renderCallouts(md, renderInner)
    expect(result).toContain('class="vault-callout"')
    expect(result).toContain('class="vault-columns"')
    expect(result).toContain('flex: 2.4')
    expect(result).toContain('text-align: right')
    expect(result).toContain('Sol Rex')
  })
})
