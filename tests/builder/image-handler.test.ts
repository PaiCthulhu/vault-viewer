import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ImageHandler, isValidImagePath } from '../../builder/image-handler'
import { safePagePath } from '../../lib/pending-page'
import { toPageProperty } from '../../builder/plugins/properties'
import { EMPTY_PROPERTY_CONFIG } from '../../builder/property-types'

const TMP = path.join(os.tmpdir(), 'image-handler-test-' + Math.random().toString(36).slice(2))

describe('ImageHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(TMP, { recursive: true, force: true })
  })

  it('não copia e registra só imagens que existem dentro do vault', () => {
    const vault = path.join(TMP, 'vault')
    fs.mkdirSync(path.join(vault, 'Imagens'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Imagens', 'a.png'), 'x')
    fs.writeFileSync(path.join(TMP, 'fora.png'), 'x')

    const handler = new ImageHandler(vault, 'v', new Map([['a.png', 'Imagens/a.png']]))

    expect(handler.resolve('a.png')).toBe('/vault-assets/v/Imagens/a.png')
    expect(handler.resolve('Imagens/a.png')).toBe('/vault-assets/v/Imagens/a.png')
    expect(handler.resolve('[[Imagens/a.png]]')).toBe('/vault-assets/v/Imagens/a.png')
    expect(handler.resolve('nao-existe.png')).toBe('/vault-assets/v/nao-existe.png')
    handler.resolve('../fora.png')

    expect(handler.assets()).toEqual(['Imagens/a.png'])
    // nada foi copiado para lugar nenhum
    expect(fs.readdirSync(TMP).sort()).toEqual(['fora.png', 'vault'])
  })

  it('arquivo fora do vault no caminho completo não impede a busca pelo nome', () => {
    const vault = path.join(TMP, 'vault')
    fs.mkdirSync(path.join(vault, 'Imagens'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Imagens', 'fora.png'), 'x')
    fs.writeFileSync(path.join(TMP, 'fora.png'), 'x')
    const handler = new ImageHandler(vault, 'v', new Map([['fora.png', 'Imagens/fora.png']]))

    expect(handler.resolve('../fora.png')).toBe('/vault-assets/v/Imagens/fora.png')
    expect(handler.assets()).toEqual(['Imagens/fora.png'])
  })

  it('assets() guarda a forma normalizada, sem duplicar', () => {
    const vault = path.join(TMP, 'vault')
    fs.mkdirSync(path.join(vault, 'Imagens'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Imagens', 'a.png'), 'x')
    const handler = new ImageHandler(vault, 'v', new Map())

    const url = handler.resolve('Imagens/../Imagens/a.png')
    handler.resolve('Imagens/a.png')

    expect(url).toBe('/vault-assets/v/Imagens/../Imagens/a.png') // a URL não muda
    expect(handler.assets()).toEqual(['Imagens/a.png'])
  })

  it('caminho inválido não é procurado: nenhuma chamada a fs, nada em assets(), a URL de sempre', () => {
    const vault = path.join(TMP, 'vault')
    fs.mkdirSync(path.join(vault, 'Imagens'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Imagens', 'a.png'), 'x')
    const handler = new ImageHandler(vault, 'v', new Map([['a.png', 'Imagens/a.png']]))
    const exists = vi.spyOn(fs, 'existsSync')
    const stat = vi.spyOn(fs, 'statSync')

    expect(handler.resolve('x\u0000.png')).toBe('/vault-assets/v/x\u0000.png')
    expect(handler.resolve('[[Imagens/a\u0000.png]]')).toBe('/vault-assets/v/Imagens/a\u0000.png')
    // O nome bate com o índice, mas a pasta tem caractere inválido: não é procurado.
    expect(handler.resolve('C:\\Imagens\\a.png')).toBe('/vault-assets/v/C:/Imagens/a.png')
    for (const c of ['<', '>', ':', '"', '|', '?', '*', '\u0001', '\t', '\n', '\u001f']) {
      expect(handler.resolve(`Imagens/a${c}.png`), JSON.stringify(c)).toBe(`/vault-assets/v/Imagens/a${c}.png`)
    }
    expect(exists).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
    expect(handler.assets()).toEqual([])

    // Caminho válido continua sendo procurado.
    handler.resolve('a.png')
    expect(stat).toHaveBeenCalled()
    expect(handler.assets()).toEqual(['Imagens/a.png'])
  })

  it('segmento com mais de 255 bytes UTF-8 ou caminho com mais de 4.096 bytes é inválido', () => {
    const seg255 = 'a'.repeat(251) + '.png'
    expect(isValidImagePath(seg255)).toBe(true)
    expect(isValidImagePath('a' + seg255)).toBe(false)
    // ç ocupa 2 bytes: 126 × 2 + 4 = 256 bytes em 130 caracteres.
    expect(isValidImagePath('ç'.repeat(126) + '.png')).toBe(false)
    expect(isValidImagePath('ç'.repeat(125) + '.png')).toBe(true)
    expect(isValidImagePath('Imagens\\' + 'a' + seg255)).toBe(false)
    const deep = (n: number) => Array.from({ length: n }, () => 'd'.repeat(99)).join('/') + '/a.png'
    // 40 segmentos de 99 + 39 barras + '/a.png' = 4.005 bytes; 41 segmentos = 4.105.
    expect(isValidImagePath(deep(40))).toBe(true)
    expect(isValidImagePath(deep(41))).toBe(false)
  })

  it('caminho longo demais não é procurado e não lança', () => {
    const vault = path.join(TMP, 'vault')
    fs.mkdirSync(vault, { recursive: true })
    const handler = new ImageHandler(vault, 'v', new Map())
    const stat = vi.spyOn(fs, 'statSync')
    const long = 'a'.repeat(33000) + '.png'
    expect(handler.resolve(long)).toBe('/vault-assets/v/' + long)
    expect(stat).not.toHaveBeenCalled()
    expect(handler.assets()).toEqual([])
  })

  it('erro do stat (ELOOP, EACCES...) conta como "não existe": não lança, fica fora de assets()', () => {
    const vault = path.join(TMP, 'vault')
    fs.mkdirSync(path.join(vault, 'Imagens'), { recursive: true })
    fs.writeFileSync(path.join(vault, 'Imagens', 'a.png'), 'x')
    const handler = new ImageHandler(vault, 'v', new Map())
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw Object.assign(new Error('too many symbolic links'), { code: 'ELOOP' })
    })
    expect(handler.resolve('Imagens/a.png')).toBe('/vault-assets/v/Imagens/a.png')
    expect(handler.assets()).toEqual([])
  })

  it('isValidImagePath recusa os mesmos caracteres que o safePagePath', () => {
    // As duas regras só diferem em `/` e `\` (separadores, que o ImageHandler aceita). O
    // plano multilíngue inteiro, então um caractere novo numa só das regex aparece aqui.
    const diff: string[] = []
    for (let code = 0; code <= 0xffff; code++) {
      const c = String.fromCharCode(code)
      if (c === '/' || c === '\\') continue
      const p = `Imagens/a${c}b.png`
      if (isValidImagePath(p) !== safePagePath(p)) diff.push(`U+${code.toString(16).padStart(4, '0')}`)
    }
    expect(diff).toEqual([])
    expect(isValidImagePath('Imagens\\a.png')).toBe(true)
    expect(isValidImagePath('Imagens/../a.png')).toBe(true)
  })

  it('toPageProperty com o ImageHandler real: valor com NUL é imagem, sem lançar', () => {
    const vault = path.join(TMP, 'vault')
    fs.mkdirSync(vault, { recursive: true })
    const handler = new ImageHandler(vault, 'v', new Map())
    const ctx = { renderWikilinks: (s: string) => s, resolveImage: (p: string) => handler.resolve(p), config: EMPTY_PROPERTY_CONFIG }

    const row = toPageProperty('pic', 'x\u0000.png', ctx)

    expect(row.locked).toBe('image')
    expect(row.html).toBe('<img class="vault-prop-thumb" src="/vault-assets/v/x%00.png" alt="" />')
    expect(handler.assets()).toEqual([])
  })
})
