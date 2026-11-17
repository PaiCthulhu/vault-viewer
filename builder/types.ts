export interface PageMeta {
  path: string                         // e.g. "Personalidades/Aldor" — forward slashes
  title: string                        // filename sem .md
  frontmatter: Record<string, unknown> // parsed YAML completo
  allFields: Record<string, unknown>   // idêntico a frontmatter (todos os campos)
  html: string                         // HTML final completo (banner + article)
  outlinks: string[]                   // paths de páginas linkadas (resolvidos)
  tags: string[]                       // de frontmatter.tags ou frontmatter.Tags
  css: string                          // CSS capturado de DataviewJS scripts
  // Barra de abas (nota-filha `note_type: tab`): só na mãe e nas abas dela, a
  // mesma lista nas duas, com a mãe primeiro. Ausente nas outras páginas.
  tabs?: PageTab[]
  // Presente (true) só em página que pode receber comentários.
  commentable?: boolean
  // Conversas anexadas à página; presente só quando há ao menos uma.
  comments?: CommentThread[]
  // Propriedades tipadas do frontmatter; presente só quando a página tem bloco Propriedades.
  properties?: PageProperty[]
}

export type PropertyType = 'text' | 'multitext' | 'number' | 'checkbox' | 'date' | 'datetime' | 'tags' | 'aliases'
export type PropertyJson = string | number | boolean | null | PropertyJson[] | { [key: string]: PropertyJson }
// Valor normalizado: text/date/datetime → string|null; number → number|null; checkbox → boolean|null;
// multitext/tags/aliases → string[]; objeto travado → cópia JSON-safe.
export type PropertyValue = PropertyJson
export type PropertyLock = 'readonly' | 'image' | 'object'
export interface PageProperty {
  key: string
  type: PropertyType
  value: PropertyValue
  html: string
  locked?: PropertyLock
  mismatch?: true
}

export interface PageComment {
  path: string             // caminho no vault, sem .md
  author: string           // `author` do frontmatter como texto ('' se ausente)
  createdAt: string | null // ISO UTC
  updatedAt: string | null // ISO UTC; null antes da primeira edição
  body: string             // markdown cru, sem frontmatter (para editar)
  html: string             // render restrito
}

export interface CommentThread {
  comment: PageComment
  replies: PageComment[]
}

export interface PageTab {
  path: string  // caminho da página (mãe ou aba)
  label: string // rótulo na barra
}

export interface VaultIndex {
  pageCount: number
  folderCount: number
  builtAt: string // ISO timestamp
  startedAt?: string // ISO timestamp de logo antes da varredura do vault
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
