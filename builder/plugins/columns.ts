interface ColBlock {
  flexGrow: number
  textAlign?: string
  content: string
}

function parseColMdBlocks(inner: string): ColBlock[] {
  const blocks: ColBlock[] = []
  // Captura blocos ```col-md...``` dentro do bloco ````col
  const regex = /^```col-md[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(inner)) !== null) {
    const blockContent = match[1]
    // Separa settings/content no separador `===` (tolera CRLF e espaços)
    const sep = blockContent.match(/\r?\n===[ \t]*\r?\n/)
    let settings = ''
    let content = blockContent
    if (sep && sep.index !== undefined) {
      settings = blockContent.slice(0, sep.index)
      content = blockContent.slice(sep.index + sep[0].length)
    }
    const flexMatch = settings.match(/flexGrow\s*=\s*([\d.]+)/)
    const flexGrow = flexMatch ? parseFloat(flexMatch[1]) : 1
    const alignMatch = settings.match(/textAlign\s*=\s*(\w+)/)
    const textAlign = alignMatch ? alignMatch[1] : undefined
    blocks.push({ flexGrow, textAlign, content: content.trim() })
  }
  return blocks
}

export async function renderColumns(
  markdown: string,
  renderContent: (md: string) => Promise<string>,
): Promise<string> {
  // Detecta blocos ````col...```` (4 backticks)
  const regex = /^````col[ \t]*\r?\n([\s\S]*?)^````[ \t]*$/gm
  const replacements: Array<{ match: string; html: string }> = []

  let m: RegExpExecArray | null
  while ((m = regex.exec(markdown)) !== null) {
    const inner = m[1]
    const blocks = parseColMdBlocks(inner)
    const colHtmls = await Promise.all(
      blocks.map(async ({ flexGrow, textAlign, content }) => {
        const rendered = await renderContent(content)
        const style = `flex: ${flexGrow}` + (textAlign ? `; text-align: ${textAlign}` : '')
        return `<div class="vault-col" style="${style}">${rendered}</div>`
      }),
    )
    replacements.push({ match: m[0], html: `<div class="vault-columns">${colHtmls.join('')}</div>` })
  }

  let result = markdown
  for (const { match, html } of replacements) {
    result = result.replace(match, (matched, offset: number, full: string) => {
      // O <div> gerado é um bloco HTML que, por CommonMark, engole as linhas
      // seguintes até uma linha em branco. Se logo após o bloco vier `\n` + linha
      // não-vazia (ex.: `# Heading`), adiciona uma linha em branco para fechar o
      // bloco HTML (espelha builder/plugins/captions.ts).
      const afterEnd = offset + matched.length
      const rest = full.slice(afterEnd)
      const followedByLine = /^\n[ \t]*\S/.test(rest)
      return followedByLine ? html + '\n' : html
    })
  }
  return result
}
