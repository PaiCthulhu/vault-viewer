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
