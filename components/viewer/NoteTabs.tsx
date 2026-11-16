'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { PageTab } from '@/builder/types'

interface NoteTabsProps {
  slug: string
  // `PageMeta.tabs`: a mãe primeiro, depois as abas, já na ordem da barra.
  tabs: PageTab[] | undefined
  currentPath: string
}

function hrefFor(slug: string, path: string): string {
  return `/vault/${slug}/${path.split('/').map(encodeURIComponent).join('/')}`
}

// Barra de abas da nota-filha (`note_type: tab`): cada aba é uma página própria, e
// clicar navega por SPA para a URL dela. Clique com modificador (nova aba/janela) ou
// com outro botão fica com o navegador; clique na aba já ativa não faz nada (navegar
// para a mesma URL reaplicaria o HTML e fecharia os <details>).
export function NoteTabs({ slug, tabs, currentPath }: NoteTabsProps) {
  const router = useRouter()
  const { t } = useI18n()
  const navRef = useRef<HTMLElement>(null)

  // A barra remonta a cada navegação, com a rolagem no começo: traz a aba ativa para
  // a vista. Só mexe na rolagem horizontal da própria barra (scrollIntoView rolaria
  // também o conteúdo até o topo).
  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('.vault-tab.is-active')
    if (!nav || !active) return
    const n = nav.getBoundingClientRect()
    const a = active.getBoundingClientRect()
    if (a.left < n.left) nav.scrollLeft = nav.scrollLeft - (n.left - a.left)
    else if (a.right > n.right) nav.scrollLeft = nav.scrollLeft + (a.right - n.right)
  }, [currentPath, tabs])

  if (!tabs || tabs.length < 2) return null

  return (
    <nav ref={navRef} className="vault-tabs" aria-label={t('tabs.nav')}>
      {tabs.map(tab => {
        const href = hrefFor(slug, tab.path)
        const active = tab.path === currentPath
        return (
          <a
            key={tab.path}
            href={href}
            className={active ? 'vault-tab is-active' : 'vault-tab'}
            aria-current={active ? 'page' : undefined}
            onClick={e => {
              if (e.defaultPrevented) return
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              e.preventDefault()
              if (!active) router.push(href)
            }}
          >
            {tab.label}
          </a>
        )
      })}
    </nav>
  )
}
