'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'
import { DataviewTable } from './DataviewTable'
import { DataviewList } from './DataviewList'
import { LinkPreview, type LinkPreviewState, type PreviewData, type ExternalPreviewData } from './LinkPreview'
import type { HtmlSegment } from '@/lib/parse-html-segments'

interface ContentPanelProps {
  segments: HtmlSegment[]
  css: string
  isWidePage: boolean
  slug: string
}

const BG_URL_RE = /url\(['"]?([^'")]+)['"]?\)/

// Mermaid must be initialized once per page load; ids must be DOM-unique.
let mermaidInitialized = false
let mermaidCounter = 0

// Module-level cache so each preview target is fetched only once per session.
const previewCache = new Map<string, Promise<PreviewData>>()
// Same pattern for external link metadata, keyed by absolute URL.
const externalPreviewCache = new Map<string, Promise<ExternalPreviewData>>()

const PREVIEW_DELAY = 350
const CARD_WIDTH = 320

export function ContentPanel({ segments, css, isWidePage, slug }: ContentPanelProps) {
  const router = useRouter()
  const { t } = useI18n()
  const articleRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  // Hover-preview state.
  const [preview, setPreview] = useState<LinkPreviewState>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentAnchor = useRef<HTMLAnchorElement | null>(null)

  // ─── Click handling (synthetic, via onClick prop) ───────────────────────────
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element

    // a. Internal vault link → client-side navigation. External links keep default.
    const a = target.closest('a')
    if (a) {
      const href = a.getAttribute('href')
      if (href?.startsWith('/vault/')) {
        e.preventDefault()
        router.push(href)
      } else if (href?.startsWith('http://') || href?.startsWith('https://')) {
        // External link → open in a new tab. Set the attributes and let the
        // browser navigate NATIVELY (no preventDefault / no window.open) so the
        // tab opens immediately and is independent of the async preview fetch.
        // Same-page heading anchors (href starting with '#') keep default too.
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener noreferrer')
      }
      hidePreview()
      return
    }

    // b. A content image (not inside a navigation card) opens the lightbox.
    const img = target.closest('img')
    if (img && articleRef.current?.contains(img) && !img.closest('.dv-card')) {
      const image = img as HTMLImageElement
      const src = image.currentSrc || image.src
      if (src) {
        e.preventDefault()
        setLightboxSrc(src)
        hidePreview()
        return
      }
    }

    // c. The banner is a background-image div, not an <img>; open its image.
    const banner = target.closest('.vault-banner')
    if (banner) {
      const style = (banner as HTMLElement).style.backgroundImage
      const m = BG_URL_RE.exec(style)
      if (m) {
        e.preventDefault()
        setLightboxSrc(m[1])
        hidePreview()
        return
      }
    }

    // d. Make a dataviewjs card navigable via its internal-link anchor.
    const card = target.closest('.dv-card, .dv-inline-gallery-card')
    if (!card) return
    const link = card.querySelector<HTMLAnchorElement>('a[href^="/vault/"]')
    const href = link?.getAttribute('href')
    if (href) {
      e.preventDefault()
      router.push(href)
    }
  }

  // ─── Hover preview handling ──────────────────────────────────────────────────
  function clearTimer() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  function hidePreview() {
    clearTimer()
    currentAnchor.current = null
    setPreview(null)
  }

  function positionFor(anchor: HTMLAnchorElement): { x: number; y: number; below: boolean } {
    const rect = anchor.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom >= 280
    const y = below ? rect.bottom + 8 : rect.top - 8
    let x = rect.left
    const maxX = window.innerWidth - CARD_WIDTH - 8
    if (x > maxX) x = Math.max(8, maxX)
    if (x < 8) x = 8
    return { x, y, below }
  }

  function handleMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    // Skip on touch / no-hover devices.
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) return

    const target = e.target as Element
    const anchor = target.closest('a') as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''

    if (anchor === currentAnchor.current) return // already handling this one

    if (href.startsWith('/vault/')) {
      currentAnchor.current = anchor
      clearTimer()
      hoverTimer.current = setTimeout(() => {
        if (currentAnchor.current !== anchor) return
        // Split off a `#heading` fragment so it doesn't leak into the page path
        // (a `[[Page#Heading]]` link → href `/vault/slug/Page#heading`).
        const hashIdx = href.indexOf('#')
        const section = hashIdx >= 0 ? decodeURIComponent(href.slice(hashIdx + 1)) : ''
        const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href

        // Derive slug + path from the href segments. Falls back to the panel's
        // own vault slug, but a wiki-link may point at another vault.
        const parts = pathPart.split('/').filter(Boolean) // ['vault', '<slug>', ...path]
        if (parts.length < 2) return
        const targetSlug = decodeURIComponent(parts[1]) || slug
        const pagePath = parts.slice(2).map(decodeURIComponent).join('/')
        if (!pagePath) return

        let p = previewCache.get(href)
        if (!p) {
          const sectionParam = section ? `&section=${encodeURIComponent(section)}` : ''
          p = fetch(
            `/api/vault/${encodeURIComponent(targetSlug)}/preview?path=${encodeURIComponent(pagePath)}${sectionParam}`,
          ).then(r => {
            if (!r.ok) throw new Error(`preview ${r.status}`)
            return r.json() as Promise<PreviewData>
          })
          previewCache.set(href, p)
        }

        // Resolve-first pattern: if the (cached) promise resolves in <50ms,
        // skip the skeleton; otherwise show a skeleton until the fetch lands.
        let settled = false
        const skeletonTimer = setTimeout(() => {
          if (settled || currentAnchor.current !== anchor) return
          const pos = positionFor(anchor)
          setPreview({ kind: 'loading', x: pos.x, y: pos.y, flip: !pos.below })
        }, 50)

        p.then(data => {
          settled = true
          clearTimeout(skeletonTimer)
          if (currentAnchor.current !== anchor) return
          const pos = positionFor(anchor)
          setPreview({
            kind: 'internal',
            title: data.title,
            image: data.image,
            snippet: data.snippet,
            imagePosition: data.imagePosition,
            x: pos.x,
            y: pos.y,
            flip: !pos.below,
          })
        }).catch(() => {
          settled = true
          clearTimeout(skeletonTimer)
          previewCache.delete(href)
          if (currentAnchor.current === anchor) setPreview(null)
        })
      }, PREVIEW_DELAY)
    } else if (href.startsWith('http')) {
      currentAnchor.current = anchor
      clearTimer()
      hoverTimer.current = setTimeout(() => {
        if (currentAnchor.current !== anchor) return

        let p = externalPreviewCache.get(href)
        if (!p) {
          p = fetch(`/api/link-preview?url=${encodeURIComponent(href)}`).then(r => {
            if (!r.ok) throw new Error(`link-preview ${r.status}`)
            return r.json() as Promise<ExternalPreviewData>
          })
          externalPreviewCache.set(href, p)
        }

        // Resolve-first pattern: if the (cached) promise resolves in <50ms,
        // skip the skeleton; otherwise show a skeleton until the fetch lands.
        let settled = false
        const skeletonTimer = setTimeout(() => {
          if (settled || currentAnchor.current !== anchor) return
          const pos = positionFor(anchor)
          setPreview({ kind: 'loading', x: pos.x, y: pos.y, flip: !pos.below })
        }, 50)

        p.then(data => {
          settled = true
          clearTimeout(skeletonTimer)
          if (currentAnchor.current !== anchor) return
          // Empty metadata (no title/description/image) → nothing useful to show.
          if (!data || (!data.title && !data.description && !data.image)) {
            setPreview(null)
            return
          }
          const pos = positionFor(anchor)
          setPreview({
            kind: 'external',
            url: href,
            data,
            x: pos.x,
            y: pos.y,
            flip: !pos.below,
          })
        }).catch(() => {
          settled = true
          clearTimeout(skeletonTimer)
          externalPreviewCache.delete(href)
          if (currentAnchor.current === anchor) setPreview(null)
        })
      }, PREVIEW_DELAY)
    }
  }

  function handleMouseOut(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = currentAnchor.current
    if (!anchor) return
    const related = e.relatedTarget as Node | null
    // Still inside the same anchor (or its children)? keep showing.
    if (related && anchor.contains(related)) return
    hidePreview()
  }

  // Close the lightbox on Escape while it is open.
  useEffect(() => {
    if (!lightboxSrc) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxSrc(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [lightboxSrc])

  // Hide preview on scroll of the content container and on any click.
  useEffect(() => {
    const el = scrollRef.current
    function onHide() {
      hidePreview()
    }
    el?.addEventListener('scroll', onHide, { passive: true })
    document.addEventListener('click', onHide)
    return () => {
      el?.removeEventListener('scroll', onHide)
      document.removeEventListener('click', onHide)
    }
  }, [])

  // Make external links open in a new tab (internal links start with /vault/).
  useEffect(() => {
    const el = articleRef.current
    if (!el) return
    const links = el.querySelectorAll<HTMLAnchorElement>(
      'a[href^="http://"], a[href^="https://"]',
    )
    links.forEach(a => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })
  }, [segments])

  // Render Mermaid diagrams client-side. The builder emits them as
  // <pre><code class="language-mermaid">...</code></pre>; we replace each with
  // a rendered SVG.
  useEffect(() => {
    const el = articleRef.current
    if (!el) return

    let cancelled = false

    async function renderMermaid(root: HTMLDivElement) {
      const codes = root.querySelectorAll<HTMLElement>(
        'pre > code.language-mermaid',
      )
      if (codes.length === 0) return

      const { default: mermaid } = await import('mermaid')
      if (cancelled) return

      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'dark',
        })
        mermaidInitialized = true
      }

      for (const code of Array.from(codes)) {
        const pre = code.parentElement
        if (!pre || !pre.isConnected) continue
        // Skip if already processed (e.g. effect re-ran on same DOM).
        if (pre.getAttribute('data-mermaid-processed') === 'true') continue
        pre.setAttribute('data-mermaid-processed', 'true')

        const source = code.textContent ?? ''
        const id = `mmd-${mermaidCounter++}`

        try {
          const { svg } = await mermaid.render(id, source)
          if (cancelled) return
          // The pre may have been removed during the await (navigation).
          if (!pre.isConnected) continue

          const wrapper = document.createElement('div')
          wrapper.className = 'mermaid-diagram'
          wrapper.innerHTML = svg
          pre.replaceWith(wrapper)
        } catch (err) {
          console.warn('Mermaid render failed:', err)
          // Leave the original <pre> untouched; allow retry on next run.
          pre.removeAttribute('data-mermaid-processed')
        }
      }
    }

    renderMermaid(el)

    return () => {
      cancelled = true
    }
  }, [segments])

  // Notion-style page-level filter bar: collect every .dv-card[data-props]
  // across the whole article (all galleries are groupings of the same
  // database), build ONE on-demand filter bar from the union of their
  // properties. Filters are added as chips via a "+ Adicionar filtro" popover
  // (no wall of selects); each chip is a property + value <select> composed
  // with AND. Cards/empty gallery groups are shown/hidden directly.
  // Plain DOM enhancement; resets on navigation since the article re-renders.
  useEffect(() => {
    const el = articleRef.current
    if (!el) return

    // A client navigation (or StrictMode double-invoke) re-applies
    // dangerouslySetInnerHTML to the segment divs, destroying any previously
    // inserted bar. Defensively remove any existing bar before rebuilding.
    el.querySelector('.dv-filterbar')?.remove()

    const galleries = Array.from(el.querySelectorAll<HTMLElement>('.dv-gallery'))
    if (galleries.length === 0) return
    const firstGallery = galleries[0]

    // Collect all cards that carry filterable props.
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.dv-card[data-props]'))
    if (cards.length < 4) return

    // Parse each card's props once.
    type Props = Record<string, string[]>
    const cardProps = new Map<HTMLElement, Props>()
    for (const card of cards) {
      const raw = card.dataset.props
      if (!raw) continue
      try {
        const parsed = JSON.parse(decodeURIComponent(raw)) as Props
        if (parsed && typeof parsed === 'object') cardProps.set(card, parsed)
      } catch {
        /* ignore malformed props */
      }
    }
    if (cardProps.size === 0) return

    // Build union of keys → unique values, and count cards that carry each key.
    const valuesByKey = new Map<string, Set<string>>()
    const cardsHavingKey = new Map<string, number>()
    for (const props of cardProps.values()) {
      for (const [key, vals] of Object.entries(props)) {
        if (!Array.isArray(vals)) continue
        let set = valuesByKey.get(key)
        if (!set) {
          set = new Set<string>()
          valuesByKey.set(key, set)
        }
        let any = false
        for (const v of vals) {
          if (typeof v === 'string') {
            set.add(v)
            any = true
          }
        }
        if (any) cardsHavingKey.set(key, (cardsHavingKey.get(key) ?? 0) + 1)
      }
    }

    // Decide which keys are useful filters (offered in the "+ Adicionar" menu).
    const keys: { key: string; values: string[]; uniq: number }[] = []
    for (const [key, set] of valuesByKey) {
      if (set.size === 0) continue
      const having = cardsHavingKey.get(key) ?? 0
      // Drop identifier-like fields: high unique-value count relative to the
      // number of cards that have the key (e.g. Líder, Localização, Integrantes).
      if (set.size >= Math.max(8, 0.7 * having)) continue
      // Drop keys where every card has the same single value (useless).
      if (set.size === 1) {
        const only = [...set][0]
        const allSame = [...cardProps.values()].every(p => {
          const v = p[key]
          return Array.isArray(v) && v.length === 1 && v[0] === only
        })
        if (allSame) continue
      }
      keys.push({
        key,
        uniq: set.size,
        values: [...set].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      })
    }
    // Most useful (fewest unique values) first; tie-break alphabetical pt-BR.
    keys.sort((a, b) => a.uniq - b.uniq || a.key.localeCompare(b.key, 'pt-BR'))
    if (keys.length === 0) return

    const keyByName = new Map(keys.map(k => [k.key, k]))

    // ─── Build the bar shell ───────────────────────────────────────────────
    const bar = document.createElement('div')
    bar.className = 'dv-filterbar'

    const label = document.createElement('span')
    label.className = 'dv-filter-label'
    label.textContent = t('content.filters')
    bar.appendChild(label)

    // Container for active filter chips (initially empty).
    const chipsWrap = document.createElement('span')
    chipsWrap.className = 'dv-filter-chips'
    bar.appendChild(chipsWrap)

    // "+ Adicionar filtro" button.
    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'dv-filter-add'
    addBtn.textContent = t('content.addFilter')
    bar.appendChild(addBtn)

    // Popover menu of available properties.
    const menu = document.createElement('div')
    menu.className = 'dv-filter-menu'
    bar.appendChild(menu)

    const count = document.createElement('span')
    count.className = 'dv-filter-count'
    bar.appendChild(count)

    const clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.className = 'dv-filter-clear'
    clearBtn.textContent = t('common.clear')
    clearBtn.style.display = 'none'
    bar.appendChild(clearBtn)

    // ─── State: active chips (property → its select element) ────────────────
    const activeChips = new Map<string, HTMLSelectElement>()

    // ─── Apply filters ─────────────────────────────────────────────────────
    const applyFilters = () => {
      const active: { key: string; value: string }[] = []
      for (const [key, select] of activeChips) {
        if (select.value) active.push({ key, value: select.value })
      }

      clearBtn.style.display = activeChips.size > 0 ? '' : 'none'

      let visible = 0
      for (const card of cards) {
        const props = cardProps.get(card)
        // Cards without parsed props always match (no properties).
        let show = true
        if (props && active.length > 0) {
          show = active.every(({ key, value }) => {
            const vals = props[key]
            return Array.isArray(vals) && vals.includes(value)
          })
        }
        card.style.display = show ? '' : 'none'
        if (show) visible++
      }

      // Per-gallery group collapse: hide a gallery with zero visible cards,
      // plus its immediately preceding group title (.dv-section-title) or
      // heading (H1–H6). Walk past the inserted bar if it sits right before.
      for (const gallery of galleries) {
        const anyVisible = Array.from(
          gallery.querySelectorAll<HTMLElement>('.dv-card'),
        ).some(c => c.style.display !== 'none')
        gallery.style.display = anyVisible ? '' : 'none'

        let prev = gallery.previousElementSibling
        if (prev === bar) prev = prev.previousElementSibling
        if (
          prev &&
          (prev.classList.contains('dv-section-title') || /^H[1-6]$/.test(prev.tagName))
        ) {
          ;(prev as HTMLElement).style.display = anyVisible ? '' : 'none'
        }
      }

      count.textContent = t(visible === 1 ? 'content.itemCountOne' : 'content.itemCountMany', { count: visible })
    }

    // ─── Popover menu of available (not-yet-active) properties ──────────────
    const rebuildMenu = () => {
      menu.textContent = ''
      const available = keys.filter(k => !activeChips.has(k.key))
      for (const { key } of available) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'dv-filter-menu-item'
        item.textContent = key
        item.addEventListener('click', () => {
          addChip(key)
          closeMenu()
        })
        menu.appendChild(item)
      }
      // No properties left to add → hide the add button.
      addBtn.style.display = available.length === 0 ? 'none' : ''
    }

    let docClickHandler: ((e: MouseEvent) => void) | null = null
    const closeMenu = () => {
      menu.classList.remove('is-open')
      if (docClickHandler) {
        document.removeEventListener('click', docClickHandler)
        docClickHandler = null
      }
    }
    const openMenu = () => {
      rebuildMenu()
      menu.classList.add('is-open')
      // One-shot outside-click close. Ignore the opening click itself by
      // attaching on the next tick.
      docClickHandler = (e: MouseEvent) => {
        if (!bar.contains(e.target as Node)) closeMenu()
      }
      setTimeout(() => {
        if (docClickHandler) document.addEventListener('click', docClickHandler)
      }, 0)
    }
    addBtn.addEventListener('click', () => {
      if (menu.classList.contains('is-open')) closeMenu()
      else openMenu()
    })

    // ─── Active filter chip: property label + value select + remove ─────────
    const addChip = (key: string) => {
      const meta = keyByName.get(key)
      if (!meta || activeChips.has(key)) return

      const chip = document.createElement('span')
      chip.className = 'dv-filter-chip'

      const name = document.createElement('span')
      name.className = 'dv-filter-chip-label'
      name.textContent = key
      chip.appendChild(name)

      const select = document.createElement('select')
      select.dataset.key = key
      const first = document.createElement('option')
      first.value = ''
      first.textContent = t('content.allValues')
      select.appendChild(first)
      for (const v of meta.values) {
        const opt = document.createElement('option')
        opt.value = v
        opt.textContent = v
        select.appendChild(opt)
      }
      select.addEventListener('change', applyFilters)
      chip.appendChild(select)

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'dv-filter-chip-remove'
      remove.setAttribute('aria-label', t('content.removeFilter', { key }))
      remove.textContent = '✕'
      remove.addEventListener('click', () => {
        activeChips.delete(key)
        chip.remove()
        rebuildMenu()
        applyFilters()
      })
      chip.appendChild(remove)

      activeChips.set(key, select)
      chipsWrap.appendChild(chip)
      rebuildMenu()
      applyFilters()
    }

    clearBtn.addEventListener('click', () => {
      activeChips.clear()
      chipsWrap.textContent = ''
      rebuildMenu()
      applyFilters()
    })

    // ─── Insert the bar ABOVE the whole grouped block ───────────────────────
    // From the first gallery, walk BACKWARD over the contiguous run of
    // header-like siblings (H1–H6, .dv-section-title, .dataview-header, or
    // empty/whitespace-only nodes) and insert before the topmost one — so the
    // bar sits above the section header AND the first group title, not between
    // a title and its cards.
    const isHeaderLike = (node: Node | null): boolean => {
      if (!node) return false
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? '').trim() === ''
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      const elNode = node as Element
      if (elNode === bar) return false
      // The page title is a barrier — never walk above it (keep the bar below it).
      if (elNode.classList.contains('vault-page-title')) return false
      return (
        /^H[1-6]$/.test(elNode.tagName) ||
        elNode.classList.contains('dv-section-title') ||
        elNode.classList.contains('dataview-header')
      )
    }

    let topmost: Node = firstGallery
    let prev: Node | null = firstGallery.previousSibling
    while (prev && isHeaderLike(prev)) {
      // Skip whitespace text nodes for the anchor, but keep walking past them.
      if (prev.nodeType === Node.ELEMENT_NODE) topmost = prev
      prev = prev.previousSibling
    }

    topmost.parentNode?.insertBefore(bar, topmost)
    rebuildMenu()
    applyFilters()

    return () => {
      if (docClickHandler) document.removeEventListener('click', docClickHandler)
    }
  }, [segments, t])

  // Relabel builder-emitted nodes (e.g. the Properties block summary) to the
  // active locale. The built HTML carries <span data-i18n="properties.title">…</span>.
  useEffect(() => {
    const el = articleRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('[data-i18n]').forEach(n => {
      const key = n.getAttribute('data-i18n'); if (key) n.textContent = t(key)
    })
  }, [segments, t])

  // Memoize the rendered segment elements so they are referentially stable
  // across re-renders that don't change the content (e.g. opening the lightbox
  // or hover-preview state changes). Without this, React re-applies a fresh
  // `dangerouslySetInnerHTML={{__html}}` object to each segment div on every
  // render, wiping any runtime DOM state — most visibly resetting a user's
  // collapsed/expanded native <details class="vault-callout"> back to its HTML
  // default. The DOM-mutating effects (mermaid, external-link target, filter
  // bar) still key on [segments], so they re-run only when the content itself
  // changes — exactly the same trigger as this memo.
  const memoizedSegments = useMemo(
    () =>
      segments.map((seg, i) => {
        if (seg.type === 'banner') {
          return (
            <div
              key={i}
              className="vault-banner-wrap"
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          )
        }
        if (seg.type === 'html') {
          return (
            <div
              key={i}
              className={`vault-article${isWidePage ? ' wide-page' : ''}`}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          )
        }
        if (seg.type === 'dataview-table') {
          return (
            <div key={i} className={`vault-article${isWidePage ? ' wide-page' : ''}`}>
              <DataviewTable columns={seg.columns} rows={seg.rows} vault={seg.vault} />
            </div>
          )
        }
        if (seg.type === 'dataview-list') {
          return (
            <div key={i} className={`vault-article${isWidePage ? ' wide-page' : ''}`}>
              <DataviewList items={seg.items} vault={seg.vault} />
            </div>
          )
        }
        return null
      }),
    [segments, isWidePage],
  )

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto h-full"
      style={{ background: 'var(--bg)' }}
    >
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}

      <div
        ref={articleRef}
        onClick={handleClick}
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseOut}
      >
        {memoizedSegments}
      </div>

      <LinkPreview state={preview} />

      {lightboxSrc && (
        <div className="vault-lightbox" onClick={() => setLightboxSrc(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxSrc} alt="" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
