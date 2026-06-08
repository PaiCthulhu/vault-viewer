import { describe, it, expect } from 'vitest'
import { applyObsidianCompat } from '../../../builder/plugins/obsidian-compat'

describe('applyObsidianCompat', () => {
  it('converte ==texto== em <mark>', () => {
    expect(applyObsidianCompat('==Comum==')).toBe('<mark>Comum</mark>')
    expect(applyObsidianCompat('==Heroico==\\==Elite==')).toContain('<mark>Heroico</mark>')
  })

  it('converte strong seguido de palavra', () => {
    const out = applyObsidianCompat('**Agora, jovem Wilfred...**mesmo tão pequeno')
    expect(out).toContain('<strong>Agora, jovem Wilfred...</strong>mesmo')
  })

  it('converte strong precedido de palavra (caso espelhado)', () => {
    const out = applyObsidianCompat('palavra**negrito**')
    expect(out).toContain('palavra<strong>negrito</strong>')
  })

  it('normaliza strong com espaço interno antes do fechamento (deixa o remark parear)', () => {
    // `**bold **` → `**bold** ` (espaço movido para fora; o remark gera o <strong>)
    const out = applyObsidianCompat('**bold **text')
    expect(out).toContain('**bold** text')
  })

  it('normaliza em com espaço interno antes do fechamento', () => {
    const out = applyObsidianCompat('isto é *advanced * mesmo')
    expect(out).toContain('*advanced* ')
  })

  it('não mexe em bullets de lista', () => {
    const out = applyObsidianCompat('* item um\n* item dois')
    expect(out).toBe('* item um\n* item dois')
  })

  it('não transforma dentro de blocos de código cercados', () => {
    const md = '```\n==nao== e **bold**x\n```'
    expect(applyObsidianCompat(md)).toBe(md)
  })

  it('não transforma dentro de código inline', () => {
    const out = applyObsidianCompat('use `==nao==` aqui ==sim==')
    expect(out).toContain('`==nao==`')
    expect(out).toContain('<mark>sim</mark>')
  })

  it('é idempotente', () => {
    const md = '==Comum== e **bold **text e palavra**x**'
    const once = applyObsidianCompat(md)
    const twice = applyObsidianCompat(once)
    expect(twice).toBe(once)
  })
})
