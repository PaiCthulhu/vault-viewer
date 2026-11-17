import { describe, it, expect, beforeEach } from 'vitest'
import matter from 'gray-matter'
import { extractFrontmatter, extractTags, parseYamlFrontmatter } from '../../builder/frontmatter'

// O bloco em JavaScript marca este global se o gray-matter o executar.
const ran = globalThis as { __frontmatterJsRan?: boolean }
const JS_BLOCK = '{ title: "Rodou", tags: ["x"], marca: (globalThis.__frontmatterJsRan = true, 1) }'

describe('extractFrontmatter — só YAML', () => {
  beforeEach(() => {
    delete ran.__frontmatterJsRan
  })

  it.each([
    ['js', `---js\n${JS_BLOCK}\n---\ncorpo\n`],
    ['javascript', `---javascript\n${JS_BLOCK}\n---\ncorpo\n`],
    ['JS em maiúsculas', `---JS\n${JS_BLOCK}\n---\ncorpo\n`],
    ['Javascript com espaço depois', `---Javascript  \n${JS_BLOCK}\n---\ncorpo\n`],
    ['js depois de um BOM', `﻿---js\n${JS_BLOCK}\n---\ncorpo\n`],
    ['js sem o --- de fechamento', `---js\n${JS_BLOCK}`],
    ['coffee', '---coffee\ntitle: "Rodou"\n---\ncorpo\n'],
    ['json', '---json\n{"title": "Rodou", "tags": ["x"]}\n---\ncorpo\n'],
    ['motor desconhecido', '---toml\ntitle = "Rodou"\n---\ncorpo\n'],
    ['js com bloco vazio', '---js\n---\ncorpo\n'],
    ['js com o bloco só de comentário', '---js\n# nada aqui\n---\ncorpo\n'],
    ['nome herdado de Object.prototype (valueOf)', '---valueOf\ntitle: Rodou\n---\ncorpo\n'],
    ['nome herdado de Object.prototype (constructor)', '---constructor\ntitle: Rodou\n---\ncorpo\n'],
    ['nome herdado de Object.prototype (isPrototypeOf)', '---isPrototypeOf\ntitle: Rodou\n---\ncorpo\n'],
  ])('outro motor (%s): frontmatter ilegível, arquivo inteiro como corpo, nada roda', (_, content) => {
    expect(extractFrontmatter(content, 'Arquivo')).toEqual({ frontmatter: {}, body: content.trim(), title: 'Arquivo' })
    expect(ran.__frontmatterJsRan).toBeUndefined()
  })

  it('controle: sem a regra, o motor JavaScript do gray-matter roda o bloco destes testes', () => {
    matter(`---js\n${JS_BLOCK}\n---\ncorpo\n`)
    expect(ran.__frontmatterJsRan).toBe(true)
  })

  it.each([
    ['---yaml', '---yaml\ntitle: Nota\n---\ncorpo\n'],
    ['---YML', '---YML\ntitle: Nota\n---\ncorpo\n'],
    ['--- com espaço no fim', '---   \ntitle: Nota\n---\ncorpo\n'],
  ])('motor YAML declarado (%s) continua lido', (_, content) => {
    expect(extractFrontmatter(content, 'Arquivo')).toEqual({ frontmatter: { title: 'Nota' }, body: 'corpo', title: 'Nota' })
  })

  // A implementação de antes desta regra, para provar que YAML comum sai igual.
  function antes(content: string, filenameTitle: string) {
    try {
      const { data, content: body } = matter(content)
      const title = (data.title as string | undefined) ?? filenameTitle
      return { frontmatter: data, body: body.trim(), title }
    } catch {
      return { frontmatter: {}, body: content.trim(), title: filenameTitle }
    }
  }

  it.each([
    ['título, tags e data sem aspas', '---\ntitle: Minha Nota\ntags:\n  - a\n  - b\ncriado: 2026-11-17\n---\n\n# Minha Nota\n\nTexto.\n'],
    ['sem frontmatter', '# Só markdown\n\nSem frontmatter.'],
    ['arquivo vazio', ''],
    ['bloco vazio', '---\n---\ncorpo'],
    ['bloco só de comentário', '---\n# nada\n---\ncorpo'],
    ['YAML quebrado', '---\ntitle: "sem fechar\n---\ncorpo'],
    ['frontmatter sem fechamento', '---\ntitle: x\ncorpo sem fechamento'],
    ['quatro traços no começo', '----\ntitle: x\n----\ncorpo'],
    ['BOM', '\uFEFF---\ntitle: Com BOM\n---\ncorpo'],
    ['escalar', '---\ntexto solto\n---\ncorpo'],
    ['lista', '---\n- a\n- b\n---\ncorpo'],
    ['régua no corpo', '---\na: 1\n---\nantes\n\n---\n\ndepois'],
  ])('YAML comum sai igual a antes (%s)', (_, content) => {
    expect(extractFrontmatter(content, 'Arquivo')).toEqual(antes(content, 'Arquivo'))
  })
})

describe('parseYamlFrontmatter', () => {
  it('separa o frontmatter YAML do corpo', () => {
    const file = parseYamlFrontmatter('---\na: 1\n---\ncorpo')
    expect(file.data).toEqual({ a: 1 })
    expect(file.content).toBe('corpo')
  })

  it('arquivo vazio não lança', () => {
    expect(parseYamlFrontmatter('').data).toEqual({})
  })

  it.each(['---js\n{ a: 1 }\n---\nx', '---json\n{"a": 1}\n---\nx', '---js\n---\nx', '---valueOf\na: 1\n---\nx'])(
    'lança com outro motor: %j',
    content => {
      expect(() => parseYamlFrontmatter(content)).toThrow()
    },
  )

  it('lança com YAML quebrado', () => {
    expect(() => parseYamlFrontmatter('---\na: "sem fechar\n---\nx')).toThrow()
  })
})

describe('extractFrontmatter', () => {
  it('extrai frontmatter YAML e body', () => {
    const md = `---
title: Aldor
Tags:
  - Personagem
cover: Imagens/Aldor.png
---

# Aldor

Conteúdo da nota.`
    const result = extractFrontmatter(md, 'Aldor')
    expect(result.frontmatter).toMatchObject({ title: 'Aldor', cover: 'Imagens/Aldor.png' })
    expect(result.frontmatter.Tags).toEqual(['Personagem'])
    expect(result.body).toContain('# Aldor')
    expect(result.body).not.toContain('---')
    expect(result.title).toBe('Aldor')
  })

  it('usa filenameTitle quando frontmatter não tem title', () => {
    const md = `---
cover: x.png
---
Corpo`
    const result = extractFrontmatter(md, 'MeuArquivo')
    expect(result.title).toBe('MeuArquivo')
  })

  it('funciona com arquivo sem frontmatter', () => {
    const md = `# Apenas markdown\n\nSem frontmatter.`
    const result = extractFrontmatter(md, 'Teste')
    expect(result.frontmatter).toEqual({})
    expect(result.body).toContain('# Apenas markdown')
    expect(result.title).toBe('Teste')
  })
})

describe('extractTags', () => {
  it('extrai array de tags', () => {
    expect(extractTags({ Tags: ['A', 'B'] })).toEqual(['A', 'B'])
    expect(extractTags({ tags: ['X'] })).toEqual(['X'])
  })

  it('converte string única em array', () => {
    expect(extractTags({ Tags: 'Personagem' })).toEqual(['Personagem'])
  })

  it('retorna [] quando sem tags', () => {
    expect(extractTags({})).toEqual([])
  })
})
