import matter from 'gray-matter'

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>
  body: string
  title: string
}

export function extractFrontmatter(content: string, filenameTitle: string): FrontmatterResult {
  try {
    const { data, content: body } = matter(content)
    const title = (data.title as string | undefined) ?? filenameTitle
    return { frontmatter: data, body: body.trim(), title }
  } catch {
    // Malformed or unclosed YAML frontmatter — treat entire content as body
    return { frontmatter: {}, body: content.trim(), title: filenameTitle }
  }
}

export function extractTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.tags ?? frontmatter.Tags ?? []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return [raw]
  return []
}
