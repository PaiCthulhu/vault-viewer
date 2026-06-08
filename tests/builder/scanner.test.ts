import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { scanVault, scanImages, countFolders } from '../../builder/scanner'

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'))
  // Estrutura:
  // tmpDir/
  //   Nota A.md
  //   Subpasta/
  //     Nota B.md
  //     imagem.png
  //   .obsidian/         ← deve ser ignorado
  //     workspace.json
  fs.writeFileSync(path.join(tmpDir, 'Nota A.md'), '# Nota A')
  fs.mkdirSync(path.join(tmpDir, 'Subpasta'))
  fs.writeFileSync(path.join(tmpDir, 'Subpasta', 'Nota B.md'), '# Nota B')
  fs.writeFileSync(path.join(tmpDir, 'Subpasta', 'imagem.png'), '')
  fs.mkdirSync(path.join(tmpDir, '.obsidian'))
  fs.writeFileSync(path.join(tmpDir, '.obsidian', 'workspace.json'), '{}')
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true })
})

describe('scanVault', () => {
  it('retorna os arquivos .md com paths relativos', () => {
    const files = scanVault(tmpDir)
    expect(files).toHaveLength(2)
    const paths = files.map(f => f.relativePath).sort()
    expect(paths).toEqual(['Nota A', 'Subpasta/Nota B'])
  })

  it('retorna o title sem extensão', () => {
    const files = scanVault(tmpDir)
    const titles = files.map(f => f.title).sort()
    expect(titles).toEqual(['Nota A', 'Nota B'])
  })

  it('ignora pastas que começam com .', () => {
    const files = scanVault(tmpDir)
    expect(files.every(f => !f.relativePath.includes('.obsidian'))).toBe(true)
  })
})

describe('scanImages', () => {
  it('retorna mapa de filename.toLowerCase() → path relativo', () => {
    const images = scanImages(tmpDir)
    expect(images.has('imagem.png')).toBe(true)
    expect(images.get('imagem.png')).toBe('Subpasta/imagem.png')
  })

  it('não inclui arquivos .md', () => {
    const images = scanImages(tmpDir)
    for (const key of images.keys()) {
      expect(key).not.toMatch(/\.md$/)
    }
  })
})

describe('countFolders', () => {
  it('conta pastas não-ocultas', () => {
    expect(countFolders(tmpDir)).toBe(1) // só "Subpasta"; ".obsidian" ignorado
  })
})
