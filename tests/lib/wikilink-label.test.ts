import { describe, it, expect } from 'vitest'
import { wikilinkLabel, itemLabel } from '@/lib/wikilink-label'
import { LinkResolver } from '@/builder/link-resolver'
import { toPageProperty, type PropertyRenderContext } from '@/builder/plugins/properties'
import { EMPTY_PROPERTY_CONFIG } from '@/builder/property-types'
import { decodeEntities } from '@/lib/preview'

const resolver = new LinkResolver([
  { absolutePath: '/v/Notes/Nota A.md', relativePath: 'Notes/Nota A', title: 'Nota A' },
  { absolutePath: '/v/Notes/Other.md', relativePath: 'Notes/Other', title: 'Other' },
])

const FIXOS = [
  '[[Nota A]]', '  [[Nota A]]  ', '[[pasta/Nota|Apelido]]', '[[pasta/Nota]]',
  '[[Nota#Seção]]', '[[Nota#Seção|Apelido]]', '[[#Seção]]',
  '[[Nota|]]', '[[Nota\\|Apelido]]', '[[Nota\\#Seção]]',
  'RPG', '', 'ver [[Nota]]', '[[A]] [[B]]', '[[A]]x', '[[]]', '[[|x]]', '[[#]]', '[[ # | ]]',
]

describe('wikilinkLabel', () => {
  it('devolve o nome mostrado para um wikilink inteiro', () => {
    expect(wikilinkLabel('[[Nota A]]')).toBe('Nota A')
    expect(wikilinkLabel('  [[Nota A]]  ')).toBe('Nota A')
    expect(wikilinkLabel('[[pasta/Nota|Apelido]]')).toBe('Apelido')
    expect(wikilinkLabel('[[pasta/Nota]]')).toBe('pasta/Nota')
    expect(wikilinkLabel('[[Nota#Seção]]')).toBe('Nota')
    expect(wikilinkLabel('[[Nota#Seção|Apelido]]')).toBe('Apelido')
    expect(wikilinkLabel('[[#Seção]]')).toBe('Seção')
    expect(wikilinkLabel('[[Nota|]]')).toBe('Nota')
    expect(wikilinkLabel('[[Nota\\|Apelido]]')).toBe('Apelido')
    expect(wikilinkLabel('[[Nota\\#Seção]]')).toBe('Nota')
  })

  it('devolve null quando o item não é, inteiro, um wikilink válido', () => {
    for (const s of ['RPG', '', 'ver [[Nota]]', '[[A]] [[B]]', '[[A]]x', '[[]]', '[[|x]]', '[[#]]', '[[ # | ]]']) {
      expect(wikilinkLabel(s)).toBeNull()
    }
  })

  it('itemLabel cai no próprio item quando não é wikilink', () => {
    expect(itemLabel('[[Nota A]]')).toBe('Nota A')
    expect(itemLabel('RPG')).toBe('RPG')
    expect(itemLabel('ver [[Nota]]')).toBe('ver [[Nota]]')
  })

  it('segue a leitura do builder (casos fixos e fuzz determinístico)', () => {
    const amostras = [...FIXOS, '[[Notes/Nota A]]', '[[Missing|Apelido]]', '[[a & <b>]]', '[[Other#a b|  c  ]]']
    const alfabeto = ['[', ']', '|', '#', '\\', ' ', '\t', '\n', 'a', 'ç', '/', '.', '&', '<']
    let seed = 12345
    // Os bits altos: os baixos de um LCG repetem em ciclos curtos.
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return (seed >>> 16) % n
    }
    for (let i = 0; i < 5000; i++) {
      const len = rand(15)
      let s = i % 2 === 0 ? '[[' : ''
      for (let j = 0; j < len; j++) s += alfabeto[rand(alfabeto.length)]
      amostras.push(s)
    }
    for (const s of amostras) {
      const html = resolver.replaceWikilinksEscaped(s.trim(), 'my-vault')
      const whole = /^<(a|span)\b[^>]*>([^<]*)<\/\1>$/.exec(html)
      const label = wikilinkLabel(s)
      expect(label !== null, JSON.stringify(s)).toBe(whole !== null)
      if (whole) expect(label, JSON.stringify(s)).toBe(decodeEntities(whole[2]))
    }
  })

  it('o texto do chip na leitura é itemLabel(item)', () => {
    const ctx: PropertyRenderContext = {
      renderWikilinks: s => resolver.replaceWikilinksEscaped(s, 'my-vault'),
      resolveImage: p => '/vault-assets/my-vault/' + p,
      config: EMPTY_PROPERTY_CONFIG,
    }
    const items = ['[[Other]]', '[[Notes/Other|Apelido]]', '[[Other#Seção]]', '[[Missing]]']
    const html = toPageProperty('related', items, ctx).html
    const chips = [...html.matchAll(/<span class="vault-prop-chip"[^>]*>([\s\S]*?)<\/span>(?=<span class="vault-prop-chip"|$)/g)]
    expect(chips).toHaveLength(items.length)
    chips.forEach((c, i) => {
      expect(decodeEntities(c[1].replace(/<[^>]*>/g, ''))).toBe(itemLabel(items[i]))
    })
  })
})
