import fs from 'fs'
import path from 'path'

export class ImageHandler {
  private copied = new Map<string, string>() // original relPath → public URL

  constructor(
    private vaultPath: string,
    private vaultSlug: string,
    private publicAssetsDir: string, // abs path to public/vault-assets
    private imageIndex: Map<string, string>, // lowercase filename → relPath in vault
  ) {}

  // Resolve um caminho de imagem e copia para public/vault-assets/[slug]/
  // Accepts: full relative path ("Imagens/Capas/Aldor.png"), bare filename ("Aldor.png"),
  // or Obsidian wikilink syntax ("[[Imagens/Capas/Aldor.png]]")
  resolve(imagePath: string): string {
    // Strip Obsidian wikilink brackets if present
    const stripped = imagePath.replace(/^\[\[(.+)\]\]$/, '$1')
    if (stripped !== imagePath) return this.resolve(stripped)

    if (this.copied.has(imagePath)) return this.copied.get(imagePath)!

    // Tenta como caminho completo primeiro, depois como nome de arquivo
    let relPath = imagePath.replace(/\\/g, '/')
    if (!fs.existsSync(path.join(this.vaultPath, relPath))) {
      const byName = this.imageIndex.get(path.basename(imagePath).toLowerCase())
      if (byName) relPath = byName
    }

    const publicUrl = `/vault-assets/${this.vaultSlug}/${relPath}`
    const srcAbs = path.join(this.vaultPath, relPath)

    if (fs.existsSync(srcAbs)) {
      const destAbs = path.join(this.publicAssetsDir, this.vaultSlug, relPath)
      fs.mkdirSync(path.dirname(destAbs), { recursive: true })
      fs.copyFileSync(srcAbs, destAbs)
    }

    this.copied.set(imagePath, publicUrl)
    return publicUrl
  }
}
