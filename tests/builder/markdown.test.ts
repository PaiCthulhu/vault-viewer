import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../builder/markdown'

describe('renderMarkdown — LaTeX math', () => {
  it('renderiza um bloco $$...$$ via KaTeX', async () => {
    const md = [
      '$$',
      '\\sf{Alfa}\\mskip{2.95em}\\sf{NV}\\mskip{0.25em}\\sf{12?}\\mskip{0.25em}\\sf{(PX}\\mskip{0.25em}\\sf{1,234,567)}',
      '$$',
    ].join('\n')
    const html = await renderMarkdown(md)
    expect(html).toContain('katex')
    // O \mskip foi convertido em <span class="mspace">; só deve sobrar dentro do
    // <annotation> que o KaTeX preserva com o TeX-fonte original — nunca como
    // texto literal renderizado para o leitor.
    expect(html).toContain('mspace')
    const withoutAnnotation = html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '')
    expect(withoutAnnotation).not.toContain('\\mskip')
  })

  it('não trata $ avulso (preços) em prosa como math', async () => {
    const md = 'O item custa $50 e o outro $100 no mercado.'
    const html = await renderMarkdown(md)
    expect(html).not.toContain('katex')
    expect(html).toContain('$50')
    expect(html).toContain('$100')
  })
})
