import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ImageHandler } from '../../builder/image-handler'

const TMP = path.join(os.tmpdir(), 'image-handler-test-' + Math.random().toString(36).slice(2))

describe('ImageHandler', () => {
  afterEach(() => fs.rmSync(TMP, { recursive: true, force: true }))

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
})
