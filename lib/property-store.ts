// Edição do valor de uma propriedade que já existe numa nota: lê, confere, grava e relê,
// na mesma fila por vault dos comentários. Ao lado dos comentários, é a outra parte do
// viewer que escreve no vault, e esta escreve no próprio arquivo da nota.
//
// O que este módulo garante:
//   - o caminho que vem de fora passa pelo `safePagePath` e pela checagem canônica
//     (`scannedVaultFile`), então apelido de caminho do Windows, link e junção não levam a
//     escrita para outro arquivo; nada dentro de `_comments/` da raiz se edita;
//   - a nota tem de estar no build com `properties`, e a chave tem de existir no disco;
//   - a configuração de propriedades (tipos e travas) é lida a cada requisição e não falha
//     aberta: se um dos arquivos existe e não pôde ser lido, nada se grava (503);
//   - chave escondida ou travada não se edita, nem pelo admin;
//   - se o disco ou o `types.json` mudou desde a linha que o cliente viu, ele recebe a linha
//     atual (409), não um 400 para um valor pensado para o tipo antigo;
//   - uma edição nunca muda o tipo da propriedade: o tipo que o próximo build daria ao valor
//     gravado tem de ser o da linha;
//   - só as linhas da chave mudam (`editFrontmatterValue`, que recusa quando não consegue
//     garantir isso), e o arquivo só é trocado se ainda tem os bytes lidos no começo da
//     tentativa, relidos antes de cada `rename`: se mudou no meio, a tentativa recomeça do
//     zero (até `MAX_EDIT_ATTEMPTS`); só uma mudança feita entre a última comparação e o
//     `rename` que dá certo é sobrescrita;
//   - a linha devolvida sai do `toPageProperty` com um contexto igual ao do build, então é a
//     mesma que o próximo build grava.
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import type { VaultConfig } from '@/types'
import type { PageMeta, PageProperty } from '@/builder/types'
import type { LinkResolver } from '@/builder/link-resolver'
import { ImageHandler } from '@/builder/image-handler'
import { isInCommentsFolder, noteFamilyFields } from '@/builder/note-family'
import { isHiddenProperty, toPageProperty, type PropertyRenderContext } from '@/builder/plugins/properties'
import {
  LIST_PROPERTY_TYPES,
  parseObsidianTypes,
  parseVaultwrightProperties,
  resolvePropertyType,
  type PropertyConfig,
} from '@/builder/property-types'
import { scanImages } from '@/builder/scanner'
import { loadVaultIgnore, type VaultIgnore } from '@/builder/vault-ignore'
import { editFrontmatterValue, readFrontmatterData, validateEditValue, type EditRefusal } from '@/lib/frontmatter-edit'
import { safePagePath, scannedVaultFile } from '@/lib/pending-page'
import { pageFilePath } from '@/lib/vault'
import { IMAGE_VALUE_ERROR, TYPE_CHANGE_ERROR } from '@/lib/property-messages'
import { codeOf, markWrote, overLocks, replaceFileIfUnchanged, vaultLinkResolver, withVaultLock } from '@/lib/vault-write'

// A primeira tentativa mais até 3 refeitas, quando a nota muda entre a leitura e a troca.
export const MAX_EDIT_ATTEMPTS = 4

// Erro com o status HTTP que a rota devolve. `extra` vai junto no corpo da resposta.
export class PropertyError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

// Ganchos para os testes: `beforeCommit` roda com o temporário já gravado, logo antes de
// conferir os bytes (simula outro escritor); `afterCommit` roda logo depois da troca (simula
// um erro com o disco já mudado).
type CommitHook = (file: string) => void | Promise<void>

export const propertyHooks: { beforeCommit: CommitHook; afterCommit: CommitHook } = {
  beforeCommit: () => {},
  afterCommit: () => {},
}

// A mensagem de cada recusa do `lib/frontmatter-edit.ts`.
const REFUSAL_MESSAGES: Record<EditRefusal, string> = {
  'no-frontmatter': 'A nota não tem frontmatter',
  unreadable: 'O frontmatter da nota não pôde ser lido',
  'duplicate-key': 'O frontmatter da nota tem chave repetida',
  'not-a-map': 'O frontmatter da nota não é um mapa de propriedades',
  'missing-key': 'A propriedade não existe na nota',
  anchor: 'A propriedade usa âncora ou alias do YAML e não pode ser reescrita',
  unsupported: 'O frontmatter desta nota tem uma forma que não dá para reescrever com segurança',
  'verify-failed': 'A gravação foi cancelada: o resultado não conferiu',
}

const notFound = (): PropertyError => new PropertyError(404, 'Nota não encontrada')

// Igualdade de valores JSON: listas na ordem, objetos sem depender da ordem das chaves.
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]))
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    const ka = Object.keys(ra)
    return ka.length === Object.keys(rb).length && ka.every(k => Object.hasOwn(rb, k) && sameJson(ra[k], rb[k]))
  }
  return a === b
}

// ─── Configuração de propriedades ─────────────────────────────────────────────

// Cópia das constantes privadas `OBSIDIAN_TYPES_FILE` e `VAULTWRIGHT_FILE` de
// `builder/property-types.ts`: mude lá e aqui juntos.
const OBSIDIAN_TYPES_FILE = '.obsidian/types.json'
const VAULTWRIGHT_FILE = '.vaultwright/properties.json'

const CONFIG_UNREADABLE = 'A configuração de propriedades do vault não pôde ser lida'

// Texto de um arquivo de configuração; `null` = ausente. Insiste sob trava, como na nota.
// Qualquer outro erro é 503: sem o arquivo, uma chave `readonly` ficaria editável naquele
// instante, e o tipo da linha poderia sair outro. O aviso leva o arquivo e o código, sem o
// caminho absoluto.
async function readConfigFile(vaultPath: string, rel: string): Promise<string | null> {
  try {
    return await overLocks(() => fsp.readFile(path.join(vaultPath, rel), 'utf8'))
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return null
    console.warn(`${rel}: não foi possível ler (${codeOf(e) || 'erro sem código'}); edição recusada`)
    throw new PropertyError(503, CONFIG_UNREADABLE)
  }
}

/**
 * A configuração de propriedades do vault, com os parsers do build (`parseObsidianTypes`,
 * `parseVaultwrightProperties`). Como no build, arquivo ausente conta como vazio e arquivo
 * malformado é ignorado com o mesmo aviso. Ao contrário do `loadPropertyConfig` do build, que
 * nunca lança, um erro de leitura não falha aberto: é `PropertyError` 503.
 */
export async function readPropertyConfig(vaultPath: string): Promise<PropertyConfig> {
  const config: PropertyConfig = { types: new Map(), readonly: new Set(), select: new Map(), colors: new Map() }

  const typesText = await readConfigFile(vaultPath, OBSIDIAN_TYPES_FILE)
  if (typesText !== null) {
    const types = parseObsidianTypes(typesText)
    if (types) config.types = types
    else console.warn(`${OBSIDIAN_TYPES_FILE}: JSON inválido ou formato inesperado; ignorado`)
  }

  const vwText = await readConfigFile(vaultPath, VAULTWRIGHT_FILE)
  if (vwText !== null) {
    const vw = parseVaultwrightProperties(vwText, (msg) => console.warn(msg))
    if (vw) Object.assign(config, vw)
    else console.warn(`${VAULTWRIGHT_FILE}: JSON inválido, versão ou formato inesperado; ignorado`)
  }

  return config
}

// O contexto de render do build (`builder/pipeline.ts`): o mesmo `LinkResolver`, o mesmo
// índice de imagens e a mesma configuração de propriedades. O resolver e o índice varrem o
// vault, então cada um só é montado quando um valor precisa dele.
function renderContext(vault: VaultConfig, ig: VaultIgnore, config: PropertyConfig): PropertyRenderContext {
  let resolver: LinkResolver | null = null
  let images: ImageHandler | null = null
  return {
    renderWikilinks: s => (resolver ??= vaultLinkResolver(vault.path, ig)).replaceWikilinksEscaped(s, vault.slug),
    resolveImage: p => (images ??= new ImageHandler(vault.path, vault.slug, scanImages(vault.path, ig))).resolve(p),
    config,
  }
}

// A página da nota no build. `null` = ausente ou ilegível (um JSON lido no meio da
// gravação não parseia).
function builtPage(slug: string, notePath: string): PageMeta | null {
  const file = pageFilePath(slug, notePath)
  if (!file) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as PageMeta
  } catch {
    return null
  }
}

// Bytes da nota; `null` se ela sumiu. Insiste enquanto o Windows segura o arquivo (antivírus,
// indexador, o Obsidian salvando), como a troca faz.
async function readBytes(abs: string): Promise<Buffer | null> {
  try {
    return await overLocks(() => fsp.readFile(abs))
  } catch (e) {
    if (codeOf(e) === 'ENOENT') return null
    throw e
  }
}

// O BOM fica no texto (`ignoreBOM`), para voltar igual na gravação.
const decodeUtf8 = (b: Buffer): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b)

export interface EditedProperty {
  property: PageProperty
  // Caminho canônico da nota (a caixa do disco), sem `.md`.
  notePath: string
  // `false` quando o valor já era esse: nada foi gravado.
  wrote: boolean
}

/**
 * Troca o valor de `key`, uma propriedade que já existe na nota `path`. `expected` é o valor
 * que o cliente viu (a linha do build); se o disco tem outro, é 409 com a linha atual.
 * `confirm` libera a troca de um valor que não é do tipo da propriedade (mismatch).
 */
export function editProperty(
  vault: VaultConfig,
  input: { path: string; key: string; value: unknown; expected: unknown; confirm: boolean },
): Promise<EditedProperty> {
  return withVaultLock(vault.slug, async () => {
    const { key } = input
    if (!safePagePath(input.path)) throw new PropertyError(400, 'Caminho inválido')
    if (isInCommentsFolder(input.path)) throw notFound()

    const ig = loadVaultIgnore(vault.path)
    // Uma vez por requisição, antes de tocar a nota: o 503 de configuração ilegível sai aqui.
    const ctx = renderContext(vault, ig, await readPropertyConfig(vault.path))
    let last: PageProperty | null = null

    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt++) {
      // O arquivo: visível para o scanner, no caminho canônico, extensão `.md` minúscula.
      const file = scannedVaultFile(vault.path, `${input.path}.md`, ig)
      if (!file || !file.rel.endsWith('.md')) throw notFound()
      const notePath = file.rel.slice(0, -3)
      if (isInCommentsFolder(notePath)) throw notFound()

      // A nota no build. A chave em si é conferida no disco.
      const page = builtPage(vault.slug, notePath)
      if (!page) throw notFound()
      if (!Array.isArray(page.properties)) throw new PropertyError(422, 'A nota não tem propriedades editáveis')

      const original = await readBytes(file.abs)
      if (!original) throw notFound()
      let text: string
      try {
        text = decodeUtf8(original)
      } catch {
        throw new PropertyError(422, 'A nota não está em UTF-8')
      }

      const read = readFrontmatterData(text)
      if (!read.ok) throw new PropertyError(422, REFUSAL_MESSAGES[read.reason])
      const { data } = read
      if (!Object.hasOwn(data, key)) throw new PropertyError(422, REFUSAL_MESSAGES['missing-key'])
      if (isHiddenProperty(key, noteFamilyFields(data).noteType !== null)) {
        throw new PropertyError(422, 'Esta propriedade não se edita')
      }

      const current = toPageProperty(key, data[key], ctx)
      last = current
      if (current.locked) throw new PropertyError(422, 'A propriedade é somente leitura')

      // Os dois 409 vêm antes da validação: se o disco (ou o `types.json`) mudou desde que o
      // cliente abriu a linha, o valor mandado foi pensado para outro tipo, e o que ele precisa
      // é da linha atual, não de um 400.
      if (!sameJson(input.expected, current.value)) {
        throw new PropertyError(409, 'A propriedade mudou desde que foi aberta', { property: current })
      }
      if (current.mismatch && !input.confirm) {
        throw new PropertyError(409, 'O valor atual não é do tipo da propriedade: confirme para substituir', {
          property: current,
        })
      }

      const valid = validateEditValue(current.type, input.value)
      if (!valid.ok) {
        // O `types.json` pode ter mudado o tipo sem mudar o valor normalizado, e aí nenhum dos
        // 409 acima dispara. Se o tipo da linha no build difere do tipo no disco, o valor foi
        // pensado para o tipo antigo: o cliente recebe a linha atual. Só no erro de validação,
        // então um valor válido no tipo novo passa e não há laço até o rebuild.
        const seen = page.properties.find((row) => row?.key === key)
        if (seen && seen.type !== current.type) {
          throw new PropertyError(409, 'A propriedade mudou desde que foi aberta', { property: current })
        }
        throw new PropertyError(400, valid.error)
      }
      const { value } = valid
      // A mesma regra do build: um valor que cita imagem do vault travaria a linha. Readonly e
      // objeto já saíram acima, então `image` é a única trava possível aqui.
      if (
        (current.type === 'text' || LIST_PROPERTY_TYPES.has(current.type)) &&
        toPageProperty(key, value, ctx).locked === 'image'
      ) {
        throw new PropertyError(400, IMAGE_VALUE_ERROR)
      }

      if (!current.mismatch && sameJson(value, current.value)) return { property: current, notePath, wrote: false }

      const edited = editFrontmatterValue(text, key, { type: current.type, value })
      if (!edited.ok) throw new PropertyError(422, REFUSAL_MESSAGES[edited.reason])
      // Uma edição nunca muda o tipo da propriedade: o tipo que o próximo build daria ao valor
      // gravado tem de ser o da linha. Limpar um número, um checkbox ou uma data inferidos
      // (`key:` vazio se lê `null`, que se infere texto) ou pôr cara de data num texto mudaria.
      const next = readFrontmatterData(edited.text)
      if (!next.ok || !Object.hasOwn(next.data, key)) {
        throw new PropertyError(422, REFUSAL_MESSAGES['verify-failed'])
      }
      if (resolvePropertyType(key, next.data[key], ctx.config) !== current.type) {
        throw new PropertyError(400, TYPE_CHANGE_ERROR)
      }

      const abs = file.abs
      const replaced = await replaceFileIfUnchanged(abs, Buffer.from(edited.text, 'utf8'), original, () =>
        propertyHooks.beforeCommit(abs),
      )
      if (!replaced) continue

      // O disco já mudou: qualquer erro daqui em diante leva a nota, para a rota pedir o build.
      try {
        await propertyHooks.afterCommit(abs)
        const after = await readBytes(abs)
        if (!after) throw new Error('a nota sumiu logo depois da gravação')
        const reread = readFrontmatterData(decodeUtf8(after))
        if (!reread.ok || !Object.hasOwn(reread.data, key)) {
          throw new Error('a nota mudou logo depois da gravação')
        }
        return { property: toPageProperty(key, reread.data[key], ctx), notePath, wrote: true }
      } catch (e) {
        throw markWrote(typeof e === 'object' && e !== null ? e : new Error(String(e)), notePath)
      }
    }

    throw new PropertyError(409, 'A nota mudou enquanto era gravada', { property: last })
  })
}
