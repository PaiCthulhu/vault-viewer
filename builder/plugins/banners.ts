import { isValidImagePath } from '../image-handler'
import { imageTarget } from './properties'

// Título como texto HTML: o mesmo escape do <h1 class="vault-page-title"> (`&` e `<`).
export function escapeTitleText(title: string): string {
  return title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

const POSITION_KEYWORD = /^(?:left|center|right|top|bottom)$/i
// Número com sinal opcional e, se houver, `%` ou uma unidade de comprimento simples (só
// letras: nenhuma abre string, função nem declaração).
const POSITION_LENGTH =
  /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|em|rem|ex|ch|cm|mm|in|pt|pc|q|vw|vh|vmin|vmax|vi|vb|[sld]v[wh]|r?lh)?$/i

// Um eixo do `background-position`: só valor de CSS válido sai no `style`; o resto cai
// no padrão (o valor vem do frontmatter, que um editor grava pela API de propriedades).
export function bannerPosition(value: unknown, fallback: string): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback
  if (typeof value !== 'string') return fallback
  const s = value.trim()
  return POSITION_KEYWORD.test(s) || POSITION_LENGTH.test(s) ? s : fallback
}

const HEIGHT_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/

// Altura em px: número finito positivo, como número ou como string numérica; senão 500.
export function bannerHeight(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(value) : '500'
  if (typeof value !== 'string') return '500'
  const s = value.trim()
  return HEIGHT_NUMBER.test(s) && Number(s) > 0 ? s : '500'
}

// URL da capa para `url('…')` dentro do atributo `style`. O `encodeURI` já codifica `"`,
// `\`, quebras de linha e `<`; faltam `'` (fecha a string CSS), `(` e `)`, e `&` (uma
// entidade como `&#39;` viraria `'` no atributo), e `#` e `?` (viram fragmento e query: um
// nome com eles nunca chegava à rota). Codificados com `%`, a rota de imagens decodifica e
// acha o mesmo arquivo. Surrogate solto faria o `encodeURI` lançar e derrubar o build do
// vault inteiro: vira U+FFFD antes.
export function bannerImageUrl(url: string): string {
  return encodeURI(url.toWellFormed()).replace(/['()&#?]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

// Só conta como capa o texto que cita imagem do vault (wikilink, caminho ou nome de arquivo com
// extensão de imagem: a mesma regra do bloco Propriedades) com caminho válido. Qualquer outro
// valor (número, checkbox, lista, data, texto comum, caminho com NUL) é campo vazio: sem banner.
// Imagem que não existe ainda dá banner.
function isCover(cover: unknown): cover is string {
  if (typeof cover !== 'string') return false
  const target = imageTarget(cover)
  return target !== null && isValidImagePath(target)
}

export function renderBanner(
  frontmatter: Record<string, unknown>,
  title: string,
  resolveImage: (p: string) => string,
  coverProperty?: string | null,
): string {
  // Determine the cover source and the property base name actually used.
  let cover: unknown
  let base: string
  if (typeof coverProperty === 'string' && coverProperty.trim() !== '') {
    base = coverProperty
    cover = frontmatter[coverProperty]
  } else if (isCover(frontmatter.cover)) {
    base = 'cover'
    cover = frontmatter.cover
  } else {
    // Accept `banner` (Obsidian Banners plugin) as the fallback. Uma `cover` que não cita
    // imagem do vault conta como ausente e também cai aqui, com os `_x`/`_y`/`_height` do
    // `banner`. Com `coverProperty` configurada não há fallback.
    base = 'banner'
    cover = frontmatter.banner
  }
  if (!isCover(cover)) return ''

  // O resolveImage recebe o valor cru, como antes: a capa que conta sai igual.
  const imgUrl = bannerImageUrl(resolveImage(cover))

  // Nenhum valor do frontmatter vai cru para o HTML: um editor grava essas chaves pela API
  // de propriedades. Valor fora do formato cai no padrão (center 50%, 500px).
  // Focal position: `${base}_x` / `${base}_y` from frontmatter.
  const y = bannerPosition(frontmatter[`${base}_y`], '50%')
  const x = bannerPosition(frontmatter[`${base}_x`], 'center')

  // Height: `${base}_height`, also accept the legacy `banner_height`. A chave escolhida é a
  // primeira não nula, como antes; só o valor dela é validado.
  const height = bannerHeight(frontmatter[`${base}_height`] ?? frontmatter.banner_height)

  return (
    `<div class="vault-banner" style="height: ${height}px; background-image: url('${imgUrl}'); background-position: ${x} ${y}; background-size: cover; background-repeat: no-repeat;">` +
    `<div class="vault-banner-gradient"></div>` +
    `<h1 class="vault-banner-title">${escapeTitleText(title)}</h1>` +
    `</div>`
  )
}
