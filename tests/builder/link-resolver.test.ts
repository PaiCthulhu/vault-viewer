import { describe, it, expect } from 'vitest'
import { LinkResolver } from '../../builder/link-resolver'
import type { ScannedFile } from '../../builder/scanner'

const files: ScannedFile[] = [
  { absolutePath: '/v/Alfa.md', relativePath: 'Exemplares/Alfa', title: 'Alfa' },
  { absolutePath: '/v/Gama.md', relativePath: 'Ensaios/Gama', title: 'Gama' },
  { absolutePath: '/v/Página Exemplo.md', relativePath: 'Página Exemplo', title: 'Página Exemplo' },
]

describe('LinkResolver.resolve', () => {
  it('resolve pelo título (case-insensitive)', () => {
    const lr = new LinkResolver(files)
    expect(lr.resolve('alfa')).toBe('Exemplares/Alfa')
    expect(lr.resolve('Alfa')).toBe('Exemplares/Alfa')
    expect(lr.resolve('ALFA')).toBe('Exemplares/Alfa')
  })

  it('retorna undefined para título desconhecido', () => {
    const lr = new LinkResolver(files)
    expect(lr.resolve('Inexistente')).toBeUndefined()
  })

  it('em caso de duplicata de título, mantém o de caminho mais curto', () => {
    const withDuplicate: ScannedFile[] = [
      ...files,
      { absolutePath: '/v/X/Alfa.md', relativePath: 'X/Y/Z/Alfa', title: 'Alfa' },
    ]
    const lr = new LinkResolver(withDuplicate)
    expect(lr.resolve('alfa')).toBe('Exemplares/Alfa') // mais curto
  })
})

describe('LinkResolver.extractOutlinks', () => {
  it('extrai links que existem no vault', () => {
    const lr = new LinkResolver(files)
    const content = 'Veja [[Alfa]] e também [[Gama|O Terceiro]].'
    const outlinks = lr.extractOutlinks(content)
    expect(outlinks).toContain('Exemplares/Alfa')
    expect(outlinks).toContain('Ensaios/Gama')
  })

  it('ignora links para páginas que não existem', () => {
    const lr = new LinkResolver(files)
    const content = '[[Alfa]] e [[PaginaInexistente]]'
    const outlinks = lr.extractOutlinks(content)
    expect(outlinks).toHaveLength(1)
    expect(outlinks[0]).toBe('Exemplares/Alfa')
  })

  it('deduplica outlinks', () => {
    const lr = new LinkResolver(files)
    const content = '[[Alfa]] aparece aqui e [[Alfa]] novamente'
    expect(lr.extractOutlinks(content)).toHaveLength(1)
  })

  it('resolve link com pipe escapado de tabela [[Alfa\\|alias]]', () => {
    const lr = new LinkResolver(files)
    const content = '| [[Alfa\\|O Primeiro]] | nota |'
    expect(lr.extractOutlinks(content)).toContain('Exemplares/Alfa')
  })
})

describe('LinkResolver.replaceWikilinks', () => {
  it('substitui [[Titulo]] por âncora HTML', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('Veja [[Alfa]]', 'myvault')
    expect(result).toContain('<a href="/vault/myvault/Exemplares/Alfa">Alfa</a>')
  })

  it('usa alias quando presente [[Titulo|Alias]]', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[Alfa|O Primeiro]]', 'myvault')
    expect(result).toContain('>O Primeiro</a>')
  })

  it('envolve link não-resolvido em span.vault-dead-link', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[Inexistente]]', 'myvault')
    expect(result).toContain('<span class="vault-dead-link">Inexistente</span>')
  })

  it('link de heading na mesma página [[#Heading]] vira âncora local', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[#Parte Um]]', 'myvault')
    expect(result).toBe('<a href="#parte-um">Parte Um</a>')
  })

  it('link de heading na mesma página com alias [[#Panorama|Panorama]]', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('**[[#Panorama|Panorama]]**', 'myvault')
    expect(result).toContain('<a href="#panorama">Panorama</a>')
  })

  it('link cross-page com heading [[Page#Heading|alias]]', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[Alfa#Secao Um|veja]]', 'myvault')
    expect(result).toContain('<a href="/vault/myvault/Exemplares/Alfa#secao-um">veja</a>')
  })

  it('resolve pipe escapado de tabela [[Page\\|Alias]] (não vira dead-link)', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('| [[Exemplares/Alfa\\|Nota Única]] | nota |', 'myvault')
    expect(result).toContain('<a href="/vault/myvault/Exemplares/Alfa">Nota Única</a>')
    expect(result).not.toContain('vault-dead-link')
  })

  it('resolve pipe escapado com heading [[Page#Heading\\|alias]]', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('| [[Alfa#Secao Um\\|veja]] | nota |', 'myvault')
    expect(result).toContain('<a href="/vault/myvault/Exemplares/Alfa#secao-um">veja</a>')
  })
})

describe('LinkResolver.replaceWikilinksEscaped', () => {
  const lr = new LinkResolver([
    { absolutePath: '/v/X.md', relativePath: 'Notes/X', title: 'X' },
  ])

  it('escapa texto fora e o display, mantendo o href', () => {
    const r = lr.replaceWikilinksEscaped('a <b> [[Notes/X|<img src=x onerror=alert(1)>]] & c', 'my-vault')
    expect(r).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(r).toContain('a &lt;b&gt;')
    expect(r).toContain('&amp; c')
    expect(r).not.toContain('<img')
    expect(r).toContain('<a href="/vault/my-vault/Notes/X">')
  })

  it('link morto com display escapado', () => {
    expect(lr.replaceWikilinksEscaped('[[Nope|<script>x</script>]]', 'my-vault')).toBe(
      '<span class="vault-dead-link">&lt;script&gt;x&lt;/script&gt;</span>',
    )
  })

  it('heading da mesma pagina sem aspas cruas no href', () => {
    const r = lr.replaceWikilinksEscaped('[[#Sec "q"]]', 'my-vault')
    expect(r).toMatch(/^<a href="#[^"]*">Sec &quot;q&quot;<\/a>$/)
  })

  it('escapa aspas simples', () => {
    expect(lr.replaceWikilinksEscaped("it's", 'my-vault')).toBe('it&#39;s')
  })

  it('replaceWikilinks continua cru', () => {
    expect(lr.replaceWikilinks('[[X|<b>B</b>]]', 's')).toBe('<a href="/vault/s/Notes/X"><b>B</b></a>')
  })

  it('wikilink invalido sai escapado', () => {
    expect(lr.replaceWikilinksEscaped('[[|<b>]]', 'my-vault')).toBe('[[|&lt;b&gt;]]')
  })

  it('barra final antes do pipe e removida; alvo terminado em s fica intacto', () => {
    expect(lr.replaceWikilinks('[[Notes/X\ |x]]', 's')).toBe('<a href="/vault/s/Notes/X">x</a>')
    expect(lr.replaceWikilinks('[[Notes/Xs]]', 's')).toBe('<span class="vault-dead-link">Notes/Xs</span>')
  })
})
