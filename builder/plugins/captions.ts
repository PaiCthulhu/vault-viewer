const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'])

function isImage(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.has(ext)
}

export function renderCaptions(
  markdown: string,
  resolveImage: (p: string) => string,
): string {
  return markdown.replace(
    /!\[\[([^\]|]+?)((?:\|[^\]|]*)*)\]\]/g,
    (original, imgPath, pipePart, offset: number, full: string) => {
      if (!isImage(imgPath.trim())) return original

      const src = resolveImage(imgPath.trim())

      // pipePart é algo como "" ou "|legenda" ou "|legenda|120" — separa as partes.
      const parts: string[] = pipePart
        ? pipePart.split('|').slice(1) // remove o primeiro vazio antes do primeiro `|`
        : []

      // Se a ÚLTIMA parte for um tamanho (`120` ou `120x80`), trata como width/height.
      let width: string | undefined
      let height: string | undefined
      if (parts.length > 0) {
        const last = parts[parts.length - 1].trim()
        const sizeMatch = last.match(/^(\d+)(?:x(\d+))?$/)
        if (sizeMatch) {
          width = sizeMatch[1]
          height = sizeMatch[2]
          parts.pop()
        }
      }

      const caption = parts.join('|').trim()
      const sizeAttrs =
        (width ? ` width="${width}"` : '') + (height ? ` height="${height}"` : '')

      let replacement: string
      if (caption) {
        // Figura com legenda (e tamanho opcional nos atributos do img).
        replacement =
          `<figure class="vault-figure">` +
          `<img src="${src}" alt="${caption}"${sizeAttrs} />` +
          `<figcaption>${caption}</figcaption>` +
          `</figure>`
      } else {
        // Sem legenda: img simples (com tamanho se houver).
        replacement = `<img src="${src}" alt=""${sizeAttrs} />`
      }

      // Fix 4: embed isolado no início de uma linha, seguido por uma linha não-vazia
      // (ex.: lista). O <img> vira um bloco HTML que, por CommonMark, engole as linhas
      // seguintes até uma linha em branco. Adiciona uma linha em branco para fechar o bloco.
      const atLineStart = offset === 0 || full[offset - 1] === '\n'
      const afterEnd = offset + original.length
      const rest = full.slice(afterEnd)
      const followedByLine = /^\n[ \t]*\S/.test(rest)
      if (atLineStart && followedByLine) {
        replacement += '\n'
      }

      return replacement
    },
  )
}
