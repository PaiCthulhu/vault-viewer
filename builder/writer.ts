import fs from 'fs'
import path from 'path'
import type { PageMeta, VaultIndex, BuildGraph, PageSummary, RelationEntry } from './types'
import { buildTree } from '@/lib/vault-tree'

// Chars ilegais em nomes de arquivo no Windows
const ILLEGAL_CHARS = /[<>:"|?*\\]/g

function toFilePath(pagePath: string): string {
  return pagePath
    .split('/')
    .map(segment => segment.replace(ILLEGAL_CHARS, '_'))
    .join(path.sep)
}

// Grava via arquivo temporário + rename, para um leitor nunca ver o arquivo pela metade.
// O tmp não termina em .json (a poda só olha .json). Se o rename falhar porque um leitor
// está com o destino aberto (Windows), grava direto e apaga o tmp.
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, data, 'utf-8')
  try {
    fs.renameSync(tmp, file)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
      fs.rmSync(tmp, { force: true })
      throw err
    }
    try {
      fs.writeFileSync(file, data, 'utf-8')
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  }
}

// Arquivo JSON de uma página: <dataDir>/pages/<caminho saneado>.json
export function pageFile(dataDir: string, pagePath: string): string {
  return path.join(dataDir, 'pages', toFilePath(pagePath) + '.json')
}

// Grava uma página e devolve o arquivo.
export function writePage(dataDir: string, page: PageMeta): string {
  const filePath = pageFile(dataDir, page.path)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileAtomic(filePath, JSON.stringify(page, null, 2))
  return filePath
}

// `file` is the path basename (filename without extension), kept alongside the
// display `title` so home/filename lookups still work even when `title` comes
// from a frontmatter property.
export function toSummaries(pages: Pick<PageMeta, 'path' | 'title' | 'tags'>[]): PageSummary[] {
  return pages.map(p => ({
    path: p.path,
    title: p.title,
    file: p.path.split('/').pop() ?? p.path,
    tags: p.tags,
  }))
}

// pages-index.json + tree.json (pastas-nota resolvidas em build para a sidebar receber pronta)
export function writeSummaries(dataDir: string, summaries: PageSummary[]): void {
  fs.mkdirSync(dataDir, { recursive: true })
  writeFileAtomic(path.join(dataDir, 'pages-index.json'), JSON.stringify(summaries))
  writeFileAtomic(path.join(dataDir, 'tree.json'), JSON.stringify(buildTree(summaries)))
}

// assets.json: relPaths das imagens citadas que existem no vault
export function writeAssets(dataDir: string, assets: string[]): void {
  fs.mkdirSync(dataDir, { recursive: true })
  writeFileAtomic(path.join(dataDir, 'assets.json'), JSON.stringify(assets))
}

// Apaga os .json de pages/ que não estão em `written` e as pastas que ficaram vazias
// (nunca a própria pages/). É best-effort: falha ao listar ou apagar (EBUSY/EPERM)
// só avisa e a poda segue. Compara em minúsculas: no NTFS `Foo` e `foo` são o mesmo
// arquivo, e renomear só a caixa de uma nota não pode apagar a página recém-gravada.
export function prunePages(dataDir: string, written: Iterable<string>): number {
  const pagesDir = path.join(dataDir, 'pages')
  if (!fs.existsSync(pagesDir)) return 0
  const keep = new Set<string>()
  for (const file of written) keep.add(path.relative(pagesDir, file).toLowerCase())

  let removed = 0
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      console.warn(`[poda] não listei ${dir}: ${(err as Error).message}`)
      return
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
        try {
          if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs)
        } catch (err) {
          console.warn(`[poda] não apaguei a pasta ${abs}: ${(err as Error).message}`)
        }
      } else if (entry.name.toLowerCase().endsWith('.json')) {
        if (!keep.has(path.relative(pagesDir, abs).toLowerCase())) {
          try {
            fs.rmSync(abs)
            removed++
          } catch (err) {
            console.warn(`[poda] não apaguei ${abs}: ${(err as Error).message}`)
          }
        }
      }
    }
  }
  walk(pagesDir)
  return removed
}

// Ordem: páginas → pages-index/tree → graph → assets → property-values → poda →
// index.json por último, para o viewer saber que o build terminou quando o index.json
// novo aparece.
export function writeOutput(
  slug: string,
  pages: PageMeta[],
  graph: BuildGraph,
  index: VaultIndex,
  dataRoot: string = path.join(process.cwd(), 'data'),
  // `summaries`: o que entra no pages-index/tree (o pipeline tira as notas-filhas); sem ele, todas as páginas.
  // `propertyValues`: índice dos valores das propriedades de lista (`property-values.json`).
  opts: {
    assets?: string[]
    alreadyWritten?: Iterable<string>
    summaries?: PageSummary[]
    propertyValues?: Record<string, string[]>
    // `propertyRelations`: candidatos e itens resolvidos das listas de relação (`property-relations.json`).
    propertyRelations?: Record<string, RelationEntry>
  } = {},
): void {
  const dataDir = path.join(dataRoot, slug)
  fs.mkdirSync(dataDir, { recursive: true })

  const already = new Set<string>()
  for (const f of opts.alreadyWritten ?? []) already.add(path.normalize(f))
  const written = new Set<string>(already)

  for (const page of pages) {
    const file = pageFile(dataDir, page.path)
    if (already.has(path.normalize(file))) continue // já gravada: não regrava
    written.add(writePage(dataDir, page))
  }

  writeSummaries(dataDir, opts.summaries ?? toSummaries(pages))
  writeFileAtomic(path.join(dataDir, 'graph.json'), JSON.stringify(graph, null, 2))
  if (opts.assets) writeAssets(dataDir, opts.assets)
  if (opts.propertyValues) {
    writeFileAtomic(path.join(dataDir, 'property-values.json'), JSON.stringify(opts.propertyValues))
  }
  if (opts.propertyRelations) {
    writeFileAtomic(path.join(dataDir, 'property-relations.json'), JSON.stringify(opts.propertyRelations))
  }

  // Sem páginas, algo deu errado na varredura: não apaga o que já existe.
  if (pages.length > 0) prunePages(dataDir, written)

  writeFileAtomic(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 2))

  console.log(`[${slug}] Escrito: ${pages.length} páginas → ${path.join(dataDir, 'pages')}`)
}
