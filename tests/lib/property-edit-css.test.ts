import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Sem os comentários: um `{` ou `}` dentro de um deles atrapalharia a contagem.
const css = readFileSync(join(process.cwd(), 'app/vault-content.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Corpo de cada `@media <query>` do arquivo, com as chaves aninhadas.
function mediaBodies(query: string): string[] {
  const bodies: string[] = []
  const head = '@media ' + query
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    const open = css.indexOf('{', at)
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) {
        bodies.push(css.slice(open + 1, i))
        break
      }
    }
  }
  return bodies
}

// As regras de um corpo sem aninhamento: [seletor, declarações].
const rules = (body: string): Array<[string, string]> =>
  [...body.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => [m[1].trim().replace(/\s+/g, ' '), m[2].trim()])

describe('valor editável no toque', () => {
  // Sem hover nada diria que o valor abre um editor. O tracejado é só do `.vault-prop-editable`,
  // que só existe para quem edita: o leitor não vê nada.
  it('em (hover: none), tracejado embaixo só no .vault-prop-editable, com a cor de borda do bloco', () => {
    const bodies = mediaBodies('(hover: none)')
    expect(bodies).toHaveLength(1)
    const found = rules(bodies[0])
    expect(found).toHaveLength(1)
    const [selector, decls] = found[0]
    expect(selector).toBe('.vault-properties .vault-prop-editable')
    expect(decls).toContain('border-bottom: 1px dashed var(--border)')
  })

  it('a borda do bloco é a mesma variável', () => {
    expect(css).toMatch(/\.vault-properties \.vault-prop-input \{[^}]*border: 1px solid var\(--border\)/)
  })
})

describe('opção do menu de lista', () => {
  it('o chip dentro da opção não tem margem', () => {
    expect(css).toMatch(/\.vault-properties \.vault-prop-option \.vault-prop-chip \{[^}]*margin: 0/)
  })

  it('a opção ativa se destaca na linha, por cima do chip', () => {
    const m = css.match(/\.vault-properties \.vault-prop-option\.is-active \{([^}]*)\}/)
    expect(m).not.toBeNull()
    expect(m![1]).toContain('var(--accent-bg)')
    expect(m![1]).toContain('inset')
  })
})

describe('nota numa relação: título, sem chip', () => {
  const noteRules = rules(css).filter(([sel]) => sel.includes('vault-prop-note'))
  const rule = (selector: string) => noteRules.find(([sel]) => sel === selector)?.[1]

  it('o item não tem pílula: sem fundo nem borda, cor do texto e peso médio', () => {
    const decls = rule('.vault-prop-note')
    expect(decls).toBeDefined()
    expect(decls).toContain('color: var(--text)')
    expect(decls).toContain('font-weight: 500')
    expect(decls).not.toMatch(/background|border|padding/)
  })

  it('o título (link e texto do editor) é sublinhado discreto, na cor do texto', () => {
    const decls = rule('.vault-prop-val .vault-prop-note > a, .vault-prop-note > .vault-prop-note-title')
    expect(decls).toBeDefined()
    expect(decls).toContain('color: var(--text)')
    expect(decls).toContain('text-decoration: underline')
    expect(decls).toMatch(/text-decoration-color: color-mix\(in srgb, currentColor \d+%, transparent\)/)
  })

  it('no hover o sublinhado fica forte', () => {
    expect(rule('.vault-prop-val .vault-prop-note > a:hover')).toContain('text-decoration-color: currentColor')
  })

  it('no editor e no menu o título não leva a margem da leitura', () => {
    const inEditor = rule('.vault-properties .vault-prop-multiselect .vault-prop-note')
    expect(inEditor).toMatch(/margin: 0 [\d.]+rem 0 0/)
    expect(inEditor).not.toContain('0.75rem')
    expect(rule('.vault-properties .vault-prop-option .vault-prop-note')).toContain('margin: 0')
  })

  it('nenhuma cor fixa: só variáveis do tema', () => {
    expect(noteRules.length).toBeGreaterThanOrEqual(5)
    for (const [sel, decls] of noteRules) expect(decls, sel).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })
})
