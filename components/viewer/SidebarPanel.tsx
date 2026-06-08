'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/I18nProvider'
import type { TreeNode } from '@/lib/vault-tree'
import type { PageSummary } from '@/builder/types'

interface SidebarPanelProps {
  slug: string
  currentPath: string
  pages: PageSummary[]
  tree: TreeNode[]
  onOpenGlobalGraph: () => void
}

function storageKey(slug: string) {
  return `vault-tree-open:${slug}`
}

// Ancestor folder paths of a page path, e.g. "A/B/Page" -> ["A", "A/B"]
function ancestorFolderPaths(pagePath: string): string[] {
  const segments = pagePath.split('/')
  const out: string[] = []
  for (let i = 0; i < segments.length - 1; i++) {
    out.push(segments.slice(0, i + 1).join('/'))
  }
  return out
}

// Collect all folder paths in the tree.
function allFolderPaths(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.isFolder && n.folderPath) {
      acc.push(n.folderPath)
      allFolderPaths(n.children, acc)
    }
  }
  return acc
}

export function SidebarPanel({ slug, currentPath, pages, tree, onOpenGlobalGraph }: SidebarPanelProps) {
  const [search, setSearch] = useState('')
  const router = useRouter()
  const { t } = useI18n()

  // Lifted folder open state — a single set of folder paths.
  // Initialize synchronously from currentPath's ancestors so the FIRST render is
  // already correct on both server and client (no hydration mismatch, no flash).
  // sessionStorage is NOT read here — it is client-only and would diverge from SSR.
  const [openFolders, setOpenFolders] = useState<Set<string>>(
    () => new Set(ancestorFolderPaths(currentPath)),
  )

  // After mount, MERGE sessionStorage-saved open folders (union only — never
  // closes the current path's ancestors). Adding folders is a small visual change
  // compared to the old empty→full rebuild.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(storageKey(slug))
    if (!raw) return
    try {
      const arr = JSON.parse(raw) as string[]
      if (!Array.isArray(arr) || arr.length === 0) return
      setOpenFolders(prev => {
        let changed = false
        const next = new Set(prev)
        for (const f of arr) {
          if (!next.has(f)) {
            next.add(f)
            changed = true
          }
        }
        return changed ? next : prev
      })
    } catch {
      /* ignore malformed storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const persist = useCallback(
    (next: Set<string>) => {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(storageKey(slug), JSON.stringify([...next]))
      }
    },
    [slug],
  )

  // Auto-reveal ancestors of the current page (without collapsing anything else).
  useEffect(() => {
    if (!currentPath) return
    const ancestors = ancestorFolderPaths(currentPath)
    if (ancestors.length === 0) return
    setOpenFolders(prev => {
      let changed = false
      const next = new Set(prev)
      for (const a of ancestors) {
        if (!next.has(a)) {
          next.add(a)
          changed = true
        }
      }
      if (changed) persist(next)
      return changed ? next : prev
    })
  }, [currentPath, persist])

  function toggleFolder(folderPath: string) {
    setOpenFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      persist(next)
      return next
    })
  }

  // Expand only (never collapse) — used when navigating to a folder note.
  function expandFolder(folderPath: string) {
    setOpenFolders(prev => {
      if (prev.has(folderPath)) return prev
      const next = new Set(prev)
      next.add(folderPath)
      persist(next)
      return next
    })
  }

  function expandAll() {
    const next = new Set(allFolderPaths(tree))
    setOpenFolders(next)
    persist(next)
  }

  function collapseAll() {
    const next = new Set<string>()
    setOpenFolders(next)
    persist(next)
  }

  const filteredPages = useMemo(() => {
    if (!search) return null
    const q = search.toLowerCase()
    const score = (title: string, path: string): number => {
      const t = title.toLowerCase()
      if (t === q) return 0
      if (t.startsWith(q)) return 1
      if (t.includes(q)) return 2
      return 3 // only path matches
    }
    return pages
      .filter(p => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
      .sort((a, b) => {
        const sa = score(a.title, a.path)
        const sb = score(b.title, b.path)
        if (sa !== sb) return sa - sb
        return a.title.localeCompare(b.title, 'pt-BR')
      })
  }, [pages, search])

  function hrefFor(path: string) {
    return `/vault/${slug}/${path.split('/').map(encodeURIComponent).join('/')}`
  }

  function navigate(path: string) {
    router.push(hrefFor(path))
  }

  function onNavClick(path: string) {
    return (e: React.MouseEvent) => {
      if (e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      navigate(path)
    }
  }

  return (
    <div className="flex h-full flex-col" style={{ borderRight: '1px solid var(--border)' }}>
      {/* Search */}
      <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('sidebar.search')}
          className="w-full rounded-md border px-3 py-1.5 text-[0.82rem]"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
      </div>

      {/* Expand / collapse all */}
      <div
        className="flex items-center justify-end gap-3 px-3 py-1.5 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={expandAll}
          className="text-[0.72rem] transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          title={t('sidebar.expandAllTitle')}
        >
          {t('sidebar.expandAll')}
        </button>
        <button
          onClick={collapseAll}
          className="text-[0.72rem] transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          title={t('sidebar.collapseAllTitle')}
        >
          {t('sidebar.collapseAll')}
        </button>
      </div>

      {/* Tree or search results */}
      <div className="flex-1 min-h-0 overflow-y-auto py-2 px-1">
        {filteredPages ? (
          filteredPages.map(p => (
            <a
              key={p.path}
              href={hrefFor(p.path)}
              onClick={onNavClick(p.path)}
              className={`filetree-node w-full text-left${p.path === currentPath ? ' active' : ''}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              📄 {p.title}
            </a>
          ))
        ) : (
          tree.map((node, i) => (
            <TreeNodeItem
              key={i}
              node={node}
              depth={0}
              currentPath={currentPath}
              onNavigate={navigate}
              hrefFor={hrefFor}
              onNavClick={onNavClick}
              openFolders={openFolders}
              onToggleFolder={toggleFolder}
              onExpandFolder={expandFolder}
            />
          ))
        )}
      </div>

      {/* Footer: global graph trigger */}
      <div className="shrink-0 px-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onOpenGlobalGraph}
          className="global-graph-trigger w-full"
          title={t('sidebar.globalGraphTitle')}
        >
          {t('sidebar.globalGraph')}
        </button>
      </div>
    </div>
  )
}

// Indentation step per depth level (px) and fixed chevron-slot width (px).
const INDENT_STEP = 16
const CHEVRON_W = 16

const chevronStyle = (toggle: boolean): React.CSSProperties => ({
  display: 'inline-block',
  width: `${CHEVRON_W}px`,
  flexShrink: 0,
  textAlign: 'center',
  fontSize: '0.7rem',
  opacity: 0.6,
  cursor: toggle ? 'pointer' : undefined,
})
const iconStyle: React.CSSProperties = { flexShrink: 0 }
const labelStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

// Animated expand/collapse wrapper: measures content height with JS and animates
// the `height` inline style (works regardless of external CSS / Tailwind quirks).
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  const [height, setHeight] = useState<string>(open ? 'auto' : '0px')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // First commit: reflect initial state without animating.
    if (firstRender.current) {
      firstRender.current = false
      setHeight(open ? 'auto' : '0px')
      return
    }
    if (open) {
      setHeight(`${el.scrollHeight}px`)
      const id = window.setTimeout(() => setHeight('auto'), 220)
      return () => window.clearTimeout(id)
    } else {
      // From `auto`: pin the current height, then collapse to 0 next frame.
      setHeight(`${el.scrollHeight}px`)
      const id = window.requestAnimationFrame(() => {
        void el.offsetHeight // force reflow so the transition runs
        window.requestAnimationFrame(() => setHeight('0px'))
      })
      return () => window.cancelAnimationFrame(id)
    }
  }, [open])

  return (
    <div
      ref={ref}
      style={{ height, overflow: 'hidden', transition: 'height 0.2s ease' }}
    >
      {children}
    </div>
  )
}

function TreeNodeItem({
  node,
  depth,
  currentPath,
  onNavigate,
  hrefFor,
  onNavClick,
  openFolders,
  onToggleFolder,
  onExpandFolder,
}: {
  node: TreeNode
  depth: number
  currentPath: string
  onNavigate: (path: string) => void
  hrefFor: (path: string) => string
  onNavClick: (path: string) => (e: React.MouseEvent) => void
  openFolders: Set<string>
  onToggleFolder: (folderPath: string) => void
  onExpandFolder: (folderPath: string) => void
}) {
  const indent = depth * INDENT_STEP
  // A folder's index page lives at its folderPath, so highlight the row when
  // either the folder note's page (node.path) or the folder index (folderPath)
  // is the current page.
  const isActive = node.path === currentPath || node.folderPath === currentPath
  const buttonRef = useRef<HTMLAnchorElement>(null)

  const isOpen = node.isFolder && !!node.folderPath && openFolders.has(node.folderPath)
  // Keep a folder's subtree mounted once it has been opened, so collapsing can
  // animate; folders never opened don't mount their subtree (performance).
  const [hasBeenOpen, setHasBeenOpen] = useState(isOpen)
  useEffect(() => {
    if (isOpen) setHasBeenOpen(true)
  }, [isOpen])

  // Scroll the active file into view on mount.
  useEffect(() => {
    if (isActive && buttonRef.current) {
      buttonRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isActive])

  if (node.isFolder) {
    const open = node.folderPath ? openFolders.has(node.folderPath) : false

    // Folder note: the folder itself is a navigable page. The chevron toggles
    // expansion; clicking the rest of the row navigates AND expands.
    const isFolderNote = !!node.path
    const chevron = open ? '▾' : '▸'

    const row = isFolderNote ? (
      <a
        ref={buttonRef}
        href={hrefFor(node.path as string)}
        onClick={e => {
          if (e.defaultPrevented) return
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
          e.preventDefault()
          onNavigate(node.path as string)
          if (node.folderPath) onExpandFolder(node.folderPath)
        }}
        className={`filetree-node is-folder w-full text-left${isActive ? ' active' : ''}`}
        style={{ paddingLeft: `${8 + indent}px`, textDecoration: 'none', color: 'inherit' }}
      >
        <span
          role="button"
          tabIndex={-1}
          style={chevronStyle(true)}
          onClick={e => {
            e.stopPropagation()
            e.preventDefault()
            if (node.folderPath) onToggleFolder(node.folderPath)
          }}
        >
          {chevron}
        </span>
        <span style={iconStyle}>📄</span>
        <span style={labelStyle}>{node.name}</span>
      </a>
    ) : (
      // Plain folder (no folder note): the row navigates to the folder's
      // auto-generated index page (at folderPath); the chevron toggles
      // expansion. Plain left-click also expands, mirroring folder notes.
      <a
        ref={buttonRef}
        href={node.folderPath ? hrefFor(node.folderPath) : undefined}
        onClick={e => {
          if (e.defaultPrevented) return
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
          e.preventDefault()
          if (node.folderPath) {
            onNavigate(node.folderPath)
            onExpandFolder(node.folderPath)
          }
        }}
        className={`filetree-node is-folder w-full text-left${isActive ? ' active' : ''}`}
        style={{ paddingLeft: `${8 + indent}px`, textDecoration: 'none', color: 'inherit' }}
      >
        <span
          role="button"
          tabIndex={-1}
          style={chevronStyle(true)}
          onClick={e => {
            e.stopPropagation()
            e.preventDefault()
            if (node.folderPath) onToggleFolder(node.folderPath)
          }}
        >
          {chevron}
        </span>
        <span style={iconStyle}>📁</span>
        <span style={labelStyle}>{node.name}</span>
      </a>
    )

    return (
      <div>
        {row}
        {hasBeenOpen && (
          <Collapsible open={open}>
            {node.children.map((child, i) => (
              <TreeNodeItem
                key={i}
                node={child}
                depth={depth + 1}
                currentPath={currentPath}
                onNavigate={onNavigate}
                hrefFor={hrefFor}
                onNavClick={onNavClick}
                openFolders={openFolders}
                onToggleFolder={onToggleFolder}
                onExpandFolder={onExpandFolder}
              />
            ))}
          </Collapsible>
        )}
      </div>
    )
  }

  return (
    <a
      ref={buttonRef}
      href={hrefFor(node.path as string)}
      onClick={onNavClick(node.path as string)}
      className={`filetree-node w-full text-left${isActive ? ' active' : ''}`}
      style={{ paddingLeft: `${8 + indent}px`, textDecoration: 'none', color: 'inherit' }}
    >
      <span style={chevronStyle(false)} />
      <span style={iconStyle}>📄</span>
      <span style={labelStyle}>{node.name}</span>
    </a>
  )
}
