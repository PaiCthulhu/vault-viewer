export interface PageMeta {
  path: string                         // e.g. "Personalidades/Aldor" — forward slashes
  title: string                        // filename sem .md
  frontmatter: Record<string, unknown> // parsed YAML completo
  allFields: Record<string, unknown>   // idêntico a frontmatter (todos os campos)
  html: string                         // HTML final completo (banner + article)
  outlinks: string[]                   // paths de páginas linkadas (resolvidos)
  tags: string[]                       // de frontmatter.tags ou frontmatter.Tags
  css: string                          // CSS capturado de DataviewJS scripts
}

export interface VaultIndex {
  pageCount: number
  folderCount: number
  builtAt: string // ISO timestamp
}

export interface PageSummary {
  path: string
  title: string // display title (resolved from titleProperty, or filename)
  file: string  // filename basename (no extension) — for filename-based lookups
  tags: string[]
}

export interface GraphNode {
  id: string    // page.path
  label: string // page.title
  tags: string[]
}

export interface GraphEdge {
  source: string // page.path
  target: string // page.path
}

export interface BuildGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
