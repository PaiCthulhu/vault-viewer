import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { overLocks, replaceFile, replaceFileIfUnchanged, withVaultLock, markWrote, wroteFirst } from '@/lib/vault-write'

const dirs: string[] = []
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-write-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const errCode = (code: string) => Object.assign(new Error(code), { code })

describe('replaceFile', () => {
  it('troca o conteúdo e não deixa temporário', async () => {
    const dir = tmp()
    const file = path.join(dir, 'n.md')
    fs.writeFileSync(file, 'antigo')
    await replaceFile(file, 'novo')
    expect(fs.readFileSync(file, 'utf8')).toBe('novo')
    expect(fs.readdirSync(dir)).toEqual(['n.md'])
  })
})

describe('replaceFileIfUnchanged', () => {
  it('grava quando nada mudou', async () => {
    const dir = tmp()
    const file = path.join(dir, 'n.md')
    fs.writeFileSync(file, 'antigo')
    const ok = await replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'))
    expect(ok).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe('novo')
    expect(fs.readdirSync(dir)).toEqual(['n.md'])
  })

  it('não grava quando o arquivo mudou antes da troca', async () => {
    const dir = tmp()
    const file = path.join(dir, 'n.md')
    fs.writeFileSync(file, 'antigo')
    const ok = await replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'), () => {
      fs.writeFileSync(file, 'outro')
    })
    expect(ok).toBe(false)
    expect(fs.readFileSync(file, 'utf8')).toBe('outro')
    expect(fs.readdirSync(dir)).toEqual(['n.md'])
  })

  it('arquivo apagado antes da troca → false e não recria', async () => {
    const dir = tmp()
    const file = path.join(dir, 'n.md')
    fs.writeFileSync(file, 'antigo')
    const ok = await replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'), () => {
      fs.unlinkSync(file)
    })
    expect(ok).toBe(false)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  // O `rename` preso pelo Windows espera e tenta de novo; cada tentativa relê e compara antes,
  // senão uma mudança feita durante a espera seria sobrescrita.
  describe('rename preso pelo Windows', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    // Quantas vezes `file` foi lido pelo `fsp.readFile`.
    function countReads(file: string): () => number {
      let n = 0
      const real = fsp.readFile.bind(fsp) as (...a: unknown[]) => Promise<unknown>
      vi.spyOn(fsp, 'readFile').mockImplementation(((p: unknown, ...rest: unknown[]) => {
        if (p === file) n++
        return real(p, ...rest)
      }) as typeof fsp.readFile)
      return () => n
    }

    it('o arquivo muda enquanto o rename está preso: false, fica o do outro escritor', async () => {
      const dir = tmp()
      const file = path.join(dir, 'n.md')
      fs.writeFileSync(file, 'antigo')
      const rename = vi.spyOn(fsp, 'rename').mockImplementationOnce(async () => {
        fs.writeFileSync(file, 'outro')
        throw errCode('EBUSY')
      })
      const ok = await replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'))
      expect(ok).toBe(false)
      expect(fs.readFileSync(file, 'utf8')).toBe('outro')
      expect(fs.readdirSync(dir)).toEqual(['n.md'])
      expect(rename).toHaveBeenCalledTimes(1)
    })

    it('o arquivo some enquanto o rename está preso: false, sem recriar', async () => {
      const dir = tmp()
      const file = path.join(dir, 'n.md')
      fs.writeFileSync(file, 'antigo')
      vi.spyOn(fsp, 'rename').mockImplementationOnce(async () => {
        fs.unlinkSync(file)
        throw errCode('EPERM')
      })
      const ok = await replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'))
      expect(ok).toBe(false)
      expect(fs.readdirSync(dir)).toEqual([])
    })

    it('EBUSY duas vezes com o arquivo intacto: relê antes de cada tentativa e grava', async () => {
      const dir = tmp()
      const file = path.join(dir, 'n.md')
      fs.writeFileSync(file, 'antigo')
      const reads = countReads(file)
      const rename = vi
        .spyOn(fsp, 'rename')
        .mockImplementationOnce(async () => {
          throw errCode('EBUSY')
        })
        .mockImplementationOnce(async () => {
          throw errCode('EBUSY')
        })
      const ok = await replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'))
      expect(ok).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('novo')
      expect(fs.readdirSync(dir)).toEqual(['n.md'])
      expect(rename).toHaveBeenCalledTimes(3)
      expect(reads()).toBe(3)
    })

    it('rename sempre preso: relança na última tentativa (as mesmas do overLocks) e apaga o temporário', async () => {
      const dir = tmp()
      const file = path.join(dir, 'n.md')
      fs.writeFileSync(file, 'antigo')
      const rename = vi.spyOn(fsp, 'rename').mockImplementation(async () => {
        throw errCode('EBUSY')
      })
      await expect(replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'))).rejects.toThrow('EBUSY')
      expect(rename).toHaveBeenCalledTimes(6)
      expect(fs.readFileSync(file, 'utf8')).toBe('antigo')
      expect(fs.readdirSync(dir)).toEqual(['n.md'])
    })

    it('outro erro no rename: relança na hora, sem repetir', async () => {
      const dir = tmp()
      const file = path.join(dir, 'n.md')
      fs.writeFileSync(file, 'antigo')
      const rename = vi.spyOn(fsp, 'rename').mockImplementation(async () => {
        throw errCode('EXDEV')
      })
      await expect(replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'))).rejects.toThrow('EXDEV')
      expect(rename).toHaveBeenCalledTimes(1)
      expect(fs.readdirSync(dir)).toEqual(['n.md'])
    })

    it('beforeCheck roda uma vez só, antes da primeira leitura', async () => {
      const dir = tmp()
      const file = path.join(dir, 'n.md')
      fs.writeFileSync(file, 'antigo')
      const reads = countReads(file)
      const seen: number[] = []
      vi.spyOn(fsp, 'rename').mockImplementationOnce(async () => {
        throw errCode('EBUSY')
      })
      const ok = await replaceFileIfUnchanged(file, Buffer.from('novo'), Buffer.from('antigo'), () => {
        seen.push(reads())
      })
      expect(ok).toBe(true)
      expect(seen).toEqual([0])
    })
  })
})

describe('overLocks', () => {
  it('repete em EBUSY e desiste em outro erro', async () => {
    let calls = 0
    const busy = async () => {
      calls++
      if (calls <= 2) throw errCode('EBUSY')
      return 'ok'
    }
    await expect(overLocks(busy)).resolves.toBe('ok')
    expect(calls).toBe(3)

    let other = 0
    const enoent = async () => {
      other++
      throw errCode('ENOENT')
    }
    await expect(overLocks(enoent)).rejects.toThrow('ENOENT')
    expect(other).toBe(1)
  })
})

describe('withVaultLock', () => {
  it('serializa no mesmo slug e usa a chave global dos comentários', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const locks = () =>
      (globalThis as unknown as Record<symbol, Map<string, unknown>>)[Symbol.for('vault-viewer.comment-locks')]

    const a = withVaultLock('v', async () => {
      order.push('a-início')
      expect(locks().has('v')).toBe(true)
      await gate
      order.push('a-fim')
    })
    const b = withVaultLock('v', async () => {
      order.push('b-início')
    })
    await new Promise(r => setTimeout(r, 20))
    expect(order).toEqual(['a-início'])
    release()
    await Promise.all([a, b])
    expect(order).toEqual(['a-início', 'a-fim', 'b-início'])
  })

  it('um fn que rejeita não trava o próximo', async () => {
    await expect(withVaultLock('w', async () => { throw new Error('x') })).rejects.toThrow('x')
    await expect(withVaultLock('w', async () => 'ok')).resolves.toBe('ok')
  })
})

describe('markWrote/wroteFirst', () => {
  it('devolve o que foi marcado', () => {
    expect(wroteFirst(markWrote(new Error('e'), 'X'))).toBe('X')
    expect(wroteFirst(markWrote(new Error('e'), null))).toBeNull()
    expect(wroteFirst(new Error('e'))).toBeUndefined()
    expect(wroteFirst('texto')).toBeUndefined()
  })
})
