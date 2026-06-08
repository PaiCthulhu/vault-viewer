export function renderBanner(
  frontmatter: Record<string, unknown>,
  title: string,
  resolveImage: (p: string) => string,
  coverProperty?: string | null,
): string {
  // Determine the cover source and the property base name actually used.
  let cover: string | undefined
  let base: string
  if (typeof coverProperty === 'string' && coverProperty.trim() !== '') {
    base = coverProperty
    cover = frontmatter[coverProperty] as string | undefined
  } else if (frontmatter.cover != null) {
    base = 'cover'
    cover = frontmatter.cover as string | undefined
  } else {
    // Accept `banner` (Obsidian Banners plugin) as the fallback.
    base = 'banner'
    cover = frontmatter.banner as string | undefined
  }
  if (!cover) return ''

  const imgUrl = resolveImage(cover)

  // Focal position: `${base}_x` / `${base}_y` from frontmatter.
  const y = (frontmatter[`${base}_y`] as string | number | undefined) ?? '50%'
  const x = (frontmatter[`${base}_x`] as string | number | undefined) ?? 'center'

  // Height: `${base}_height`, also accept the legacy `banner_height`.
  const height =
    (frontmatter[`${base}_height`] as number | undefined) ??
    (frontmatter.banner_height as number | undefined) ??
    500

  return (
    `<div class="vault-banner" style="height: ${height}px; background-image: url('${encodeURI(imgUrl)}'); background-position: ${x} ${y}; background-size: cover; background-repeat: no-repeat;">` +
    `<div class="vault-banner-gradient"></div>` +
    `<h1 class="vault-banner-title">${title}</h1>` +
    `</div>`
  )
}
