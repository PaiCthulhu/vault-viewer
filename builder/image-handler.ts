import fs from 'fs'
import path from 'path'

// Caractere de controle (NUL incluído) ou caractere que o Windows recusa em nome de arquivo:
// a mesma classe do `safePagePath` (lib/pending-page.ts), que um teste mantém igual. `/` e `\`
// são separadores e valem aqui; o ImageHandler troca `\` por `/`.
const INVALID_PATH_CHARS = /[<>:"|?*\x00-\x1f]/
// Limites de comprimento, em bytes UTF-8: um nome de arquivo (segmento) e o caminho inteiro.
const MAX_SEGMENT_BYTES = 255
const MAX_PATH_BYTES = 4096

// Texto que pode ser caminho de imagem no vault. Um inválido nem é procurado: com NUL, o
// stat lançaria e derrubaria o build do vault inteiro; um nome longo demais não existe em
// nenhum disco.
export function isValidImagePath(p: string): boolean {
  if (INVALID_PATH_CHARS.test(p)) return false
  if (Buffer.byteLength(p, 'utf8') > MAX_PATH_BYTES) return false
  return p.split(/[\\/]/).every(seg => Buffer.byteLength(seg, 'utf8') <= MAX_SEGMENT_BYTES)
}

export class ImageHandler {
  private resolved = new Map<string, string>() // imagePath original → URL pública
  private found = new Set<string>() // relPaths que existem como arquivo dentro do vault

  constructor(
    private vaultPath: string,
    private vaultSlug: string,
    private imageIndex: Map<string, string>, // lowercase filename → relPath in vault
  ) {}

  // Resolve um caminho de imagem para a URL /vault-assets/[slug]/[relPath]. Não copia
  // nada: a rota do viewer serve direto da pasta do vault, e assets() lista o que existe.
  // Accepts: full relative path ("Imagens/Capas/Aldor.png"), bare filename ("Aldor.png"),
  // or Obsidian wikilink syntax ("[[Imagens/Capas/Aldor.png]]")
  resolve(imagePath: string): string {
    // Strip Obsidian wikilink brackets if present
    const stripped = imagePath.replace(/^\[\[(.+)\]\]$/, '$1')
    if (stripped !== imagePath) return this.resolve(stripped)

    if (this.resolved.has(imagePath)) return this.resolved.get(imagePath)!

    let relPath = imagePath.replace(/\\/g, '/')
    // Caminho inválido não é procurado (nenhuma chamada a fs, nada em assets()); a URL sai
    // como sempre saiu.
    if (isValidImagePath(imagePath)) {
      // Tenta como caminho completo primeiro, depois como nome de arquivo
      if (!fs.existsSync(path.join(this.vaultPath, relPath))) {
        const byName = this.imageIndex.get(path.basename(imagePath).toLowerCase())
        if (byName) relPath = byName
      }

      const normalized = this.insideVaultFile(relPath)
      if (normalized) this.found.add(normalized)
    }

    const publicUrl = `/vault-assets/${this.vaultSlug}/${relPath}`
    this.resolved.set(imagePath, publicUrl)
    return publicUrl
  }

  // relPaths resolvidos que existem como arquivo dentro do vault; únicos e ordenados.
  assets(): string[] {
    return [...this.found].sort()
  }

  // Forma normalizada (relativa ao vault, com `/`) se for arquivo dentro do vault; senão null.
  private insideVaultFile(relPath: string): string | null {
    const root = path.resolve(this.vaultPath)
    const abs = path.resolve(root, relPath)
    if (!abs.startsWith(root + path.sep)) return null
    // Rede de segurança: um erro do stat (ELOOP, EACCES, EPERM...) conta como "não existe",
    // e a imagem fica fora do assets.json em vez de derrubar o build do vault.
    let stat: fs.Stats | undefined
    try {
      stat = fs.statSync(abs, { throwIfNoEntry: false })
    } catch {
      return null
    }
    if (!(stat?.isFile() ?? false)) return null
    return path.relative(root, abs).replace(/\\/g, '/')
  }
}
