// Renderiza callouts do Obsidian (`> [!type]±? Título`) em HTML.
// Suporta conteúdo aninhado (colunas, wikilinks, markdown) via callback renderInner.

interface CalloutMeta {
  icon: string
}

const CALLOUT_MAP: Record<string, CalloutMeta> = {
  note: { icon: '📝' },
  info: { icon: 'ℹ️' },
  tip: { icon: '💡' },
  hint: { icon: '💡' },
  warning: { icon: '⚠️' },
  caution: { icon: '⚠️' },
  danger: { icon: '⛔' },
  error: { icon: '⛔' },
  quote: { icon: '💬' },
  cite: { icon: '💬' },
  example: { icon: '📋' },
  question: { icon: '❓' },
  help: { icon: '❓' },
  faq: { icon: '❓' },
  success: { icon: '✅' },
  check: { icon: '✅' },
  done: { icon: '✅' },
  userinput: { icon: '💬' },
}

const DEFAULT_ICON = '📝'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Remove um único <p>…</p> externo (o que `renderInner` produz para texto inline),
// preservando o HTML interno. Mantém intacto se houver múltiplos blocos.
function stripOuterParagraph(html: string): string {
  const t = html.trim()
  const m = /^<p>([\s\S]*)<\/p>$/.exec(t)
  if (m && !/<p[\s>]/.test(m[1])) return m[1]
  return t
}

// Constrói o HTML do título do callout. O título é renderizado como markdown
// COMPLETO via `renderInner` (negrito, itálico, highlight, links markdown,
// wikilinks, etc.), removendo o wrapper <p>. Se começa com `#{1,6} `, vira heading.
async function buildTitleHtml(
  title: string,
  renderInner: (md: string) => Promise<string>,
): Promise<string> {
  const headingMatch = title.match(/^(#{1,6})[ \t]+(.*)$/)
  const raw = headingMatch ? headingMatch[2].trim() : title
  const inner = stripOuterParagraph(await renderInner(raw))
  if (headingMatch) {
    const level = headingMatch[1].length
    return `<h${level} class="vault-callout-heading">${inner}</h${level}>`
  }
  return inner
}

// Remove o prefixo `> ` (ou `>`) de uma linha de blockquote.
function stripQuotePrefix(line: string): string {
  // `> x`, `>x`, ou `>` sozinho
  return line.replace(/^>[ \t]?/, '')
}

// Detecta um cabeçalho de callout mais profundo que depth 1 (`> > [!...]`, etc).
// Após aparar espaços, exige 2+ marcadores `>` antes do `[!`.
function isDeeperCalloutHeader(line: string): boolean {
  return /^(?:>\s*){2,}\[!/.test(line.trim())
}

export async function renderCallouts(
  markdown: string,
  renderInner: (md: string) => Promise<string>,
): Promise<string> {
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  // Rastreia regiões de código cercadas (``` / ~~~ / 4+ crases), linha-a-linha,
  // espelhando obsidian-compat.ts. Linhas dentro de uma cerca nunca iniciam nem
  // são consumidas como callouts.
  let inFence = false
  let fenceMarker = ''

  while (i < lines.length) {
    const line = lines[i]

    // ── Rastreamento de cercas de código ─────────────────────────────────────
    const fenceMatch = line.match(/^[ \t]*(`{3,}|~{3,})/)
    if (inFence) {
      out.push(line)
      if (fenceMatch) {
        const m = fenceMatch[1]
        if (m[0] === fenceMarker[0] && m.length >= fenceMarker.length) {
          inFence = false
          fenceMarker = ''
        }
      }
      i++
      continue
    }
    if (fenceMatch) {
      inFence = true
      fenceMarker = fenceMatch[1]
      out.push(line)
      i++
      continue
    }

    // Cabeçalho de callout: `> [!type]±? Título opcional`
    const header = line.match(/^>[ \t]?\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/)
    if (header) {
      const type = header[1].toLowerCase()
      const marker = header[2] // '+', '-', ou ''
      const title = header[3].trim()

      // Coleta linhas do callout. Continua por linhas iniciando com `>` OU por
      // linhas não-vazias de continuação lazy (CommonMark) logo após uma linha `>`.
      // Termina em uma linha em branco não-`>` ou EOF.
      const innerLines: string[] = []
      i++
      let prevWasQuote = true
      while (i < lines.length) {
        const cur = lines[i]
        if (/^>/.test(cur)) {
          innerLines.push(stripQuotePrefix(cur))
          prevWasQuote = true
          i++
        } else if (
          prevWasQuote &&
          cur.trim() !== '' &&
          !/^(`{3,}|~{3,}|#{1,6}\s)/.test(cur)
        ) {
          // Continuação lazy (CommonMark): apenas texto de parágrafo pode ser
          // lazy. Linhas que INICIAM um novo bloco — cerca de código (``` / ~~~),
          // heading (#…) ou linha em branco — encerram o callout em vez de serem
          // engolidas.
          innerLines.push(cur)
          prevWasQuote = true
          i++
        } else {
          break
        }
      }

      const innerMd = innerLines.join('\n')
      const innerHtml = await renderInner(innerMd)
      const meta = CALLOUT_MAP[type] ?? { icon: DEFAULT_ICON }
      const titleText = title || capitalize(type)
      const titleHtml = await buildTitleHtml(titleText, renderInner)

      const foldable = marker === '+' || marker === '-'
      let calloutHtml: string
      if (foldable) {
        const openAttr = marker === '+' ? ' open' : ''
        calloutHtml =
          `<details class="vault-callout" data-callout="${type}"${openAttr}>` +
          `<summary class="vault-callout-title">` +
          `<span class="vault-callout-icon">${meta.icon}</span>` +
          `<span class="vault-callout-title-inner">${titleHtml}</span>` +
          `<span class="vault-callout-fold">▾</span>` +
          `</summary>` +
          `<div class="vault-callout-content">${innerHtml}</div>` +
          `</details>`
      } else {
        calloutHtml =
          `<div class="vault-callout" data-callout="${type}">` +
          `<div class="vault-callout-title">` +
          `<span class="vault-callout-icon">${meta.icon}</span>` +
          `<span class="vault-callout-title-inner">${titleHtml}</span>` +
          `</div>` +
          `<div class="vault-callout-content">${innerHtml}</div>` +
          `</div>`
      }
      out.push(calloutHtml)
      // O HTML do callout é um bloco HTML que, por CommonMark, engole as linhas
      // seguintes até uma linha em branco. Se a linha que encerrou o callout for
      // não-vazia (ex.: `# Heading` colado ao callout), insere uma linha em branco
      // para fechar o bloco HTML antes dela.
      if (i < lines.length && lines[i].trim() !== '') {
        out.push('')
      }
      continue
    }

    // Linha de blockquote que NÃO é um callout de depth 1. Pode conter um callout
    // mais profundo (`> > [!note]+`) aninhado num blockquote comum. Coletamos a
    // run máxima de linhas de blockquote (com continuações lazy, como acima).
    if (/^>/.test(line)) {
      const runLines: string[] = [line]
      i++
      let prevWasQuote = true
      while (i < lines.length) {
        const cur = lines[i]
        if (/^>/.test(cur)) {
          runLines.push(cur)
          prevWasQuote = true
          i++
        } else if (
          prevWasQuote &&
          cur.trim() !== '' &&
          !/^(`{3,}|~{3,}|#{1,6}\s)/.test(cur)
        ) {
          runLines.push(cur)
          prevWasQuote = true
          i++
        } else {
          break
        }
      }

      // Algum nível mais profundo contém um callout? Se sim, removemos UM nível de
      // prefixo `> ` e recorremos: o passe de callout da recursão pega o callout
      // agora em depth 1. Embrulhamos num blockquote (espelha o blockquote comum).
      if (runLines.some(isDeeperCalloutHeader)) {
        const stripped = runLines.map(stripQuotePrefix).join('\n')
        const innerHtml = await renderInner(stripped)
        out.push(`<blockquote class="vault-blockquote">${innerHtml}</blockquote>`)
        continue
      }

      // Blockquote comum sem callout aninhado: deixa para o remark.
      out.push(...runLines)
      continue
    }

    out.push(line)
    i++
  }

  return out.join('\n')
}
