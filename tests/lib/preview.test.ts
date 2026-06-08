import { describe, it, expect } from 'vitest'
import { buildPreview, decodeEntities } from '../../lib/preview'

describe('decodeEntities', () => {
  it('decodes the basic entity set', () => {
    expect(decodeEntities('a &amp; b &lt;x&gt; &quot;q&quot; &#39;s&#39;')).toBe(
      `a & b <x> "q" 's'`,
    )
  })

  it('decodes hex entities for angle brackets', () => {
    expect(decodeEntities('&#x3C;tag&#x3E;')).toBe('<tag>')
  })

  it('decodes numeric decimal entities', () => {
    expect(decodeEntities('foo &#8211; bar')).toBe('foo – bar')
  })

  it('decodes numeric hex entities (code points)', () => {
    expect(decodeEntities('foo &#x2014; bar')).toBe('foo — bar')
  })

  it('decodes named typographic entities', () => {
    expect(
      decodeEntities('a&ndash;b&mdash;c&hellip;d&rsquo;e&ldquo;f&rdquo;'),
    ).toBe('a–b—c…d’e“f”')
  })

  it('decodes a mix of named, decimal and hex entities', () => {
    expect(
      decodeEntities('A&nbsp;&amp;&nbsp;B &#8211; C &#x2014; D'),
    ).toBe('A & B – C — D')
  })

  it('decodes &amp; last so &amp;#8211; stays literal-safe', () => {
    // &amp;#8211; should become &#8211; (NOT an en-dash).
    expect(decodeEntities('x &amp;#8211; y')).toBe('x &#8211; y')
  })

  it('keeps invalid numeric code points as the original text', () => {
    const input = '&#1114112;' // > max code point (0x10FFFF)
    expect(decodeEntities(input)).toBe(input)
  })
})

describe('buildPreview', () => {
  it('extracts banner background-image and skips banner from snippet', () => {
    const html =
      `<div class="vault-banner" style="background-image: url('/vault-assets/b.jpg')">` +
      '<div class="vault-banner-gradient"></div>' +
      '<h1 class="vault-banner-title">Title</h1></div>' +
      '<div class="vault-article"><p>Body text here.</p></div>'
    const { image, snippet } = buildPreview(html)
    expect(image).toBe('/vault-assets/b.jpg')
    expect(snippet).toBe('Body text here.')
  })

  it('parses the banner background-position as imagePosition', () => {
    const html =
      `<div class="vault-banner" style="background-image: url('/vault-assets/b.jpg'); background-position: center 51.4%;">` +
      '<div class="vault-banner-gradient"></div>' +
      '<h1 class="vault-banner-title">Title</h1></div>' +
      '<div class="vault-article"><p>Body text here.</p></div>'
    const { imagePosition } = buildPreview(html)
    expect(imagePosition).toBe('center 51.4%')
  })

  it('falls back to the first vault-asset image when no banner', () => {
    const html = '<p>Intro</p><img src="/vault-assets/pic.png" alt="x"><p>More</p>'
    const { image, imagePosition } = buildPreview(html)
    expect(image).toBe('/vault-assets/pic.png')
    expect(imagePosition).toBeNull()
  })

  it('returns null image when none present', () => {
    const { image } = buildPreview('<p>just text</p>')
    expect(image).toBeNull()
  })

  it('strips the vault-page-title heading from the snippet', () => {
    const html = '<h1 class="vault-page-title">My Page</h1><p>Real content.</p>'
    const { snippet } = buildPreview(html)
    expect(snippet).toBe('Real content.')
  })

  it('strips tags, collapses whitespace and decodes entities', () => {
    const html = '<p>Hello   &amp;    <b>world</b></p>'
    const { snippet } = buildPreview(html)
    expect(snippet).toBe('Hello & world')
  })

  it('trims long text at a word boundary with an ellipsis', () => {
    const word = 'lorem '
    const html = '<p>' + word.repeat(100) + '</p>'
    const { snippet } = buildPreview(html)
    expect(snippet.length).toBeLessThanOrEqual(321)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).not.toContain('lore…') // cut at a space, not mid-word
  })
})
