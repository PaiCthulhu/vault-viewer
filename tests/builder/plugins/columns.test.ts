import { describe, it, expect } from 'vitest'
import { renderColumns } from '../../../builder/plugins/columns'
import { renderMarkdown } from '../../../builder/markdown'

const identity = async (md: string) => `<p>${md.trim()}</p>`

describe('renderColumns', () => {
  it('substitui bloco col por div.vault-columns', async () => {
    const md = `\`\`\`\`col
\`\`\`col-md
flexGrow=1
===
Esquerda
\`\`\`
\`\`\`col-md
flexGrow=2
===
Direita
\`\`\`
\`\`\`\``

    const result = await renderColumns(md, identity)
    expect(result).toContain('class="vault-columns"')
    expect(result).toContain('flex: 1')
    expect(result).toContain('flex: 2')
    expect(result).toContain('<p>Esquerda</p>')
    expect(result).toContain('<p>Direita</p>')
  })

  it('preserva markdown fora de blocos col', async () => {
    const md = `Parágrafo normal.

\`\`\`\`col
\`\`\`col-md
flexGrow=1
===
Coluna
\`\`\`
\`\`\`\`

Após colunas.`

    const result = await renderColumns(md, identity)
    expect(result).toContain('Parágrafo normal.')
    expect(result).toContain('Após colunas.')
    expect(result).toContain('class="vault-columns"')
  })

  it('usa flexGrow=1 como padrão quando não especificado', async () => {
    const md = `\`\`\`\`col
\`\`\`col-md
===
Sem flex
\`\`\`
\`\`\`\``
    const result = await renderColumns(md, identity)
    expect(result).toContain('flex: 1')
  })

  it('retorna texto inalterado quando não há blocos col', async () => {
    const md = 'Apenas texto sem colunas.'
    const result = await renderColumns(md, identity)
    expect(result).toBe('Apenas texto sem colunas.')
  })

  it('detecta o separador === com CRLF', async () => {
    const md =
      '````col\r\n```col-md\r\nflexGrow=2.4\r\n===\r\nEsquerda\r\n```\r\n```col-md\r\nflexGrow=0.8\r\n===\r\nDireita\r\n```\r\n````'
    const result = await renderColumns(md, identity)
    expect(result).toContain('flex: 2.4')
    expect(result).toContain('flex: 0.8')
    expect(result).toContain('<p>Esquerda</p>')
    expect(result).toContain('<p>Direita</p>')
    // settings (flexGrow=...) não devem vazar para o conteúdo
    expect(result).not.toContain('flexGrow')
  })

  it('insere linha em branco quando o bloco col é seguido por um heading colado', async () => {
    // Caso real (Drakkonia): bloco ````col seguido SEM linha em branco por `# Demografia`.
    // Sem o fix, o <div> HTML gerado engole o heading (CommonMark continua o bloco
    // HTML até uma linha em branco).
    const md = `\`\`\`\`col
\`\`\`col-md
===
Coluna
\`\`\`
\`\`\`\`
# Demografia`
    const result = await renderColumns(md, identity)
    // Deve haver uma linha em branco entre o </div> das colunas e o heading.
    expect(result).toMatch(/<\/div>\n\n# Demografia/)
    // E renderizado pelo markdown, o heading vira <h1>, não texto literal.
    const html = await renderMarkdown(result)
    expect(html).toContain('<h1')
    expect(html).toContain('Demografia')
    expect(html).not.toContain('# Demografia')
  })

  it('emite text-align quando textAlign está nas settings', async () => {
    const md = `\`\`\`\`col
\`\`\`col-md
flexGrow=0.8
textAlign=right
===
Direita
\`\`\`
\`\`\`\``
    const result = await renderColumns(md, identity)
    expect(result).toContain('text-align: right')
  })
})
