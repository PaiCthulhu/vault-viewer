import { describe, it, expect } from 'vitest'
import { LinkResolver } from '../../builder/link-resolver'
import type { ScannedFile } from '../../builder/scanner'

const files: ScannedFile[] = [
  { absolutePath: '/v/Aldor.md', relativePath: 'Personagens/Aldor', title: 'Aldor' },
  { absolutePath: '/v/Magus.md', relativePath: 'Magia/Magus', title: 'Magus' },
  { absolutePath: '/v/Página Inicial.md', relativePath: 'Página Inicial', title: 'Página Inicial' },
]

describe('LinkResolver.resolve', () => {
  it('resolve pelo título (case-insensitive)', () => {
    const lr = new LinkResolver(files)
    expect(lr.resolve('aldor')).toBe('Personagens/Aldor')
    expect(lr.resolve('Aldor')).toBe('Personagens/Aldor')
    expect(lr.resolve('ALDOR')).toBe('Personagens/Aldor')
  })

  it('retorna undefined para título desconhecido', () => {
    const lr = new LinkResolver(files)
    expect(lr.resolve('Inexistente')).toBeUndefined()
  })

  it('em caso de duplicata de título, mantém o de caminho mais curto', () => {
    const withDuplicate: ScannedFile[] = [
      ...files,
      { absolutePath: '/v/X/Aldor.md', relativePath: 'X/Y/Z/Aldor', title: 'Aldor' },
    ]
    const lr = new LinkResolver(withDuplicate)
    expect(lr.resolve('aldor')).toBe('Personagens/Aldor') // mais curto
  })
})

describe('LinkResolver.extractOutlinks', () => {
  it('extrai links que existem no vault', () => {
    const lr = new LinkResolver(files)
    const content = 'Veja [[Aldor]] e também [[Magus|O Mago]].'
    const outlinks = lr.extractOutlinks(content)
    expect(outlinks).toContain('Personagens/Aldor')
    expect(outlinks).toContain('Magia/Magus')
  })

  it('ignora links para páginas que não existem', () => {
    const lr = new LinkResolver(files)
    const content = '[[Aldor]] e [[PaginaInexistente]]'
    const outlinks = lr.extractOutlinks(content)
    expect(outlinks).toHaveLength(1)
    expect(outlinks[0]).toBe('Personagens/Aldor')
  })

  it('deduplica outlinks', () => {
    const lr = new LinkResolver(files)
    const content = '[[Aldor]] aparece aqui e [[Aldor]] novamente'
    expect(lr.extractOutlinks(content)).toHaveLength(1)
  })
})

describe('LinkResolver.replaceWikilinks', () => {
  it('substitui [[Titulo]] por âncora HTML', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('Veja [[Aldor]]', 'myvault')
    expect(result).toContain('<a href="/vault/myvault/Personagens/Aldor">Aldor</a>')
  })

  it('usa alias quando presente [[Titulo|Alias]]', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[Aldor|O Guerreiro]]', 'myvault')
    expect(result).toContain('>O Guerreiro</a>')
  })

  it('envolve link não-resolvido em span.vault-dead-link', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[Inexistente]]', 'myvault')
    expect(result).toContain('<span class="vault-dead-link">Inexistente</span>')
  })

  it('link de heading na mesma página [[#Heading]] vira âncora local', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[#Draconis Fundamentum]]', 'myvault')
    expect(result).toBe('<a href="#draconis-fundamentum">Draconis Fundamentum</a>')
  })

  it('link de heading na mesma página com alias [[#Aether|Aether]]', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('**[[#Aether|Aether]]**', 'myvault')
    expect(result).toContain('<a href="#aether">Aether</a>')
  })

  it('link cross-page com heading [[Page#Heading|alias]]', () => {
    const lr = new LinkResolver(files)
    const result = lr.replaceWikilinks('[[Aldor#Secao Um|veja]]', 'myvault')
    expect(result).toContain('<a href="/vault/myvault/Personagens/Aldor#secao-um">veja</a>')
  })
})
