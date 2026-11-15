import fs from 'fs'
import path from 'path'

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

    // Tenta como caminho completo primeiro, depois como nome de arquivo
    let relPath = imagePath.replace(/\\/g, '/')
    if (!fs.existsSync(path.join(this.vaultPath, relPath))) {
      const byName = this.imageIndex.get(path.basename(imagePath).toLowerCase())
      if (byName) relPath = byName
    }

    const normalized = this.insideVaultFile(relPath)
    if (normalized) this.found.add(normalized)

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
    if (!(fs.statSync(abs, { throwIfNoEntry: false })?.isFile() ?? false)) return null
    return path.relative(root, abs).replace(/\\/g, '/')
  }
}
