import type { JWTPayload } from '@/types'

/**
 * Authorization for vault images, which the builder copies to
 * `public/vault-assets/<slug>/…`.
 *
 * Next serves `public/` straight from disk, so the proxy is the only place that
 * can gate those files. Every asset belongs to exactly one vault (the first path
 * segment), and the rule is the same one the vault page applies: admins see
 * every vault, readers only the vaults they were granted.
 *
 * Paths are checked the way the static server will resolve them, not the way
 * they arrive: percent-decoded (`%2f` stays encoded in `pathname` but the file
 * lookup decodes it) and case-folded (the filesystem on the host is
 * case-insensitive, so `/VAULT-ASSETS/x` reaches the same file as
 * `/vault-assets/x`).
 */

const ASSET_PREFIX = '/vault-assets/'

export type PathCheck =
  | { kind: 'invalid' } // undecodable, or climbs with `..` / backslashes
  | { kind: 'asset'; slug: string }
  | { kind: 'other' }

export function classifyPath(pathname: string): PathCheck {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return { kind: 'invalid' }
  }
  if (decoded.includes('\\') || decoded.split('/').includes('..')) {
    return { kind: 'invalid' }
  }
  if (!decoded.toLowerCase().startsWith(ASSET_PREFIX)) return { kind: 'other' }
  // The slug keeps its case: permissions store the configured slug, which may
  // have capitals. An odd-cased path to some vault then matches no grant and is
  // refused, which is the safe side.
  const slug = decoded.slice(ASSET_PREFIX.length).split('/')[0]
  if (!slug) return { kind: 'invalid' }
  return { kind: 'asset', slug }
}

/**
 * HTTP status for an asset request: 200 lets it through, 401 means no valid
 * session, 404 means no access to that vault (same as the vault page's
 * `notFound()`, so a reader can't probe which vaults exist).
 */
export function assetAccessStatus(
  slug: string,
  user: JWTPayload | null,
  hasVaultAccess: (userId: number, slug: string) => boolean,
): 200 | 401 | 404 {
  if (!user) return 401
  if (user.isAdmin) return 200
  return hasVaultAccess(user.userId, slug) ? 200 : 404
}
