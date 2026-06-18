import { slug } from 'github-slugger'
import type { ScannedFile } from './scanner'

export class LinkResolver {
  private titleToPath = new Map<string, string>()
  private pathToPath = new Map<string, string>() // relativePath (lowercase) → relativePath

  constructor(files: ScannedFile[]) {
    for (const f of files) {
      const key = f.title.toLowerCase()
      const existing = this.titleToPath.get(key)
      if (!existing || f.relativePath.split('/').length < existing.split('/').length) {
        this.titleToPath.set(key, f.relativePath)
      }
      // Indexa também pelo caminho relativo completo, para wikilinks que incluem
      // a pasta (ex.: [[02_Will/Saude Pratica e Rotina|alias]]).
      this.pathToPath.set(f.relativePath.toLowerCase(), f.relativePath)
    }
  }

  resolve(target: string): string | undefined {
    const lower = target.trim().toLowerCase()
    if (!lower) return undefined
    // 1. Caminho relativo completo (com ou sem extensão .md).
    const byPath = this.pathToPath.get(lower) ?? this.pathToPath.get(lower.replace(/\.md$/, ''))
    if (byPath) return byPath
    // 2. Nome do arquivo (título).
    const byTitle = this.titleToPath.get(lower)
    if (byTitle) return byTitle
    // 3. Último segmento de um caminho que não casou exatamente (ex.: "pasta/Arquivo").
    if (lower.includes('/')) {
      return this.titleToPath.get(lower.split('/').pop() as string)
    }
    return undefined
  }

  extractOutlinks(content: string): string[] {
    const pattern = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g
    const seen = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      // Dentro de tabelas, o pipe do wikilink é escapado como `\|`; o regex
      // captura a barra invertida no fim do alvo — removida aqui.
      const resolved = this.resolve(match[1].replace(/\\\s*$/, '').trim())
      if (resolved) seen.add(resolved)
    }
    return [...seen]
  }

  replaceWikilinks(content: string, vaultSlug: string): string {
    return content.replace(
      /\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g,
      (original, title, heading, alias) => {
        // Dentro de tabelas, o pipe do wikilink é escapado como `\|` (e `#` como
        // `\#`); o regex captura a barra invertida no fim do título/heading que
        // precede o pipe. Removida aqui para o alvo resolver corretamente.
        const titleStr = (title ?? '').replace(/\\\s*$/, '').trim()
        const headingStr = (heading ?? '').replace(/\\\s*$/, '').trim()
        const aliasStr = alias?.trim()

        // Sem título e sem heading: não é um wikilink válido, mantém original.
        if (!titleStr && !headingStr) return original

        // Link para heading na mesma página: [[#Heading|alias]]
        if (!titleStr && headingStr) {
          const display = aliasStr || headingStr
          if (!display) return original
          return `<a href="#${slug(headingStr)}">${display}</a>`
        }

        const resolved = this.resolve(titleStr)
        const display = aliasStr || titleStr
        // Display vazio (ex.: leftover de embed não-imagem): mantém original.
        if (!display) return original

        const fragment = headingStr ? `#${slug(headingStr)}` : ''
        if (resolved) {
          const href = `/vault/${vaultSlug}/${resolved.split('/').map(encodeURIComponent).join('/')}`
          return `<a href="${href}${fragment}">${display}</a>`
        }
        return `<span class="vault-dead-link">${display}</span>`
      },
    )
  }
}
