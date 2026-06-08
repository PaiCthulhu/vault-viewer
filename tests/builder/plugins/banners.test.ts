import { describe, it, expect } from 'vitest'
import { renderBanner } from '../../../builder/plugins/banners'

const resolveImage = (p: string) => `/vault-assets/myvault/${p}`

describe('renderBanner', () => {
  it('retorna string vazia quando não há cover', () => {
    expect(renderBanner({}, 'Título', resolveImage)).toBe('')
    expect(renderBanner({ cover: '' }, 'Título', resolveImage)).toBe('')
  })

  it('gera div.vault-banner com background-image', () => {
    const html = renderBanner({ cover: 'Imagens/Aldor.png' }, 'Aldor', resolveImage)
    expect(html).toContain('class="vault-banner"')
    expect(html).toContain("url('/vault-assets/myvault/Imagens/Aldor.png')")
  })

  it('aplica cover_y como background-position', () => {
    const html = renderBanner({ cover: 'img.png', cover_y: '30%' }, 'T', resolveImage)
    expect(html).toContain('background-position: center 30%')
  })

  it('usa posição padrão center 50% quando não especificado', () => {
    const html = renderBanner({ cover: 'img.png' }, 'T', resolveImage)
    expect(html).toContain('background-position: center 50%')
  })

  it('honra cover_x e cover_y juntos em background-position', () => {
    const html = renderBanner({ cover: 'img.png', cover_x: '20%', cover_y: '30%' }, 'T', resolveImage)
    expect(html).toContain('background-position: 20% 30%')
  })

  it('coverProperty explícito "banner" usa frontmatter.banner + banner_y/banner_x', () => {
    const html = renderBanner(
      { banner: 'b.png', banner_y: '10%', banner_x: '80%' },
      'T',
      resolveImage,
      'banner',
    )
    expect(html).toContain("url('/vault-assets/myvault/b.png')")
    expect(html).toContain('background-position: 80% 10%')
  })

  it('coverProperty explícito ignora frontmatter.cover quando ausente', () => {
    expect(renderBanner({ cover: 'img.png' }, 'T', resolveImage, 'banner')).toBe('')
  })

  it('aplica banner_height customizado', () => {
    const html = renderBanner({ cover: 'img.png', banner_height: 300 }, 'T', resolveImage)
    expect(html).toContain('height: 300px')
  })

  it('usa height padrão 500px', () => {
    const html = renderBanner({ cover: 'img.png' }, 'T', resolveImage)
    expect(html).toContain('height: 500px')
  })

  it('estilo inline contém background-size: cover e no-repeat', () => {
    const html = renderBanner({ cover: 'img.png' }, 'T', resolveImage)
    expect(html).toContain('background-size: cover')
    expect(html).toContain('background-repeat: no-repeat')
  })

  it('inclui vault-banner-gradient e vault-banner-title', () => {
    const html = renderBanner({ cover: 'img.png' }, 'Aldor', resolveImage)
    expect(html).toContain('class="vault-banner-gradient"')
    expect(html).toContain('class="vault-banner-title"')
    expect(html).toContain('>Aldor<')
  })
})
