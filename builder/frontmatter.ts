import matter from 'gray-matter'

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>
  body: string
  title: string
}

// Frontmatter só em YAML, no builder e na API de comentários. O gray-matter escolhe o
// motor pela palavra depois do `---` (`---js`, `---json`, ...), e o de JavaScript roda o
// bloco com `eval` na máquina que lê o arquivo. Um arquivo posto no vault à mão, por um
// agente ou pelo serviço de sincronização não pode rodar código pelo frontmatter, e o
// Obsidian só lê YAML. Então qualquer outro motor é frontmatter ilegível.
const refuseEngine = (): never => {
  throw new Error('motor de frontmatter não aceito')
}
// Recusados antes de rodar: `javascript` e `json`, que vêm com o gray-matter, e `coffee`,
// que ele não traz mas reconhece por apelido (`coffeescript`, `cson`), caso alguém registre
// esse motor em `matter.engines`. Um nome sem motor registrado já lança sozinho.
const YAML_ONLY = { engines: { javascript: refuseEngine, coffee: refuseEngine, json: refuseEngine } }

// O motor declarado decide, não o conteúdo do bloco: o gray-matter não chama motor nenhum
// num bloco vazio ou só de comentários, e aceita como motor os nomes herdados de
// `Object.prototype` (`---valueOf`, `---constructor`). Os nomes que ele lê como YAML são
// `yaml` e `yml`, em qualquer caixa; sem nome declarado, é YAML. `matter('')` devolve o
// resultado sem `language`.
function isYaml(language: string | undefined): boolean {
  const name = (language || 'yaml').toLowerCase()
  return name === 'yaml' || name === 'yml'
}

/**
 * Separa o frontmatter YAML do corpo. Lança quando o frontmatter é ilegível: YAML
 * quebrado ou outro motor declarado depois do `---`. Nada do bloco é executado.
 */
export function parseYamlFrontmatter(content: string): matter.GrayMatterFile<string> {
  const file = matter(content, YAML_ONLY)
  if (!isYaml(file.language)) throw new Error(`motor de frontmatter não aceito: ${file.language}`)
  return file
}

export function extractFrontmatter(content: string, filenameTitle: string): FrontmatterResult {
  try {
    const { data, content: body } = parseYamlFrontmatter(content)
    const title = (data.title as string | undefined) ?? filenameTitle
    return { frontmatter: data, body: body.trim(), title }
  } catch {
    // Frontmatter ilegível (YAML quebrado ou sem fechar, outro motor): o arquivo inteiro é o corpo.
    return { frontmatter: {}, body: content.trim(), title: filenameTitle }
  }
}

export function extractTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.tags ?? frontmatter.Tags ?? []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return [raw]
  return []
}
