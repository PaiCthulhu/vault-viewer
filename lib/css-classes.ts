// A note's `cssclasses` frontmatter, as Obsidian reads it (a list, or a string
// separated by spaces/commas). The viewer puts these classes on the article, so
// vault CSS that targets them works here too — e.g. a view.css that widens the
// page with `.my-class { --file-line-width: 100%; }`. Anything that isn't a
// plain class name is dropped.
const CLASS_NAME = /^-?[A-Za-z_][\w-]*$/

export function pageCssClasses(frontmatter: Record<string, unknown> | undefined): string[] {
  const raw = frontmatter?.cssclasses
  const items = Array.isArray(raw) ? raw : [raw]
  const out: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    for (const name of item.split(/[\s,]+/)) {
      if (CLASS_NAME.test(name) && !out.includes(name)) out.push(name)
    }
  }
  return out
}
