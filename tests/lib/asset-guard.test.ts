import { describe, it, expect } from 'vitest'
import { classifyPath, assetAccessStatus } from '@/lib/asset-guard'

describe('classifyPath', () => {
  it('extracts the vault slug from an asset path', () => {
    expect(classifyPath('/vault-assets/notes/assets/banner.png')).toEqual({ kind: 'asset', slug: 'notes' })
  })

  it('treats a differently-cased prefix as an asset (case-insensitive disk)', () => {
    expect(classifyPath('/VAULT-ASSETS/notes/a.png')).toEqual({ kind: 'asset', slug: 'notes' })
  })

  // Permissions hold the configured slug, which may have capitals. A folded slug
  // would deny a reader every image of `MeuVault`; an odd-cased path to another
  // vault only fails closed (no grant matches it).
  it('keeps the slug as written', () => {
    expect(classifyPath('/vault-assets/MeuVault/a.png')).toEqual({ kind: 'asset', slug: 'MeuVault' })
    expect(classifyPath('/VAULT-ASSETS/Notes/a.png')).toEqual({ kind: 'asset', slug: 'Notes' })
  })

  it('decodes before classifying, like the static file lookup does', () => {
    expect(classifyPath('/vault-assets/%6eotes/a.png')).toEqual({ kind: 'asset', slug: 'notes' })
    expect(classifyPath('/vault-assets%2fnotes/a.png')).toEqual({ kind: 'asset', slug: 'notes' })
  })

  it('rejects traversal, even when it only appears after decoding', () => {
    expect(classifyPath('/vault-assets/vault-a/..%2fnotes/a.png')).toEqual({ kind: 'invalid' })
    expect(classifyPath('/login%2f..%2fvault-assets/notes/a.png')).toEqual({ kind: 'invalid' })
    expect(classifyPath('/vault-assets/notes%5c..%5cother/a.png')).toEqual({ kind: 'invalid' })
  })

  it('rejects malformed percent-encoding and an empty slug', () => {
    expect(classifyPath('/vault-assets/%E0%A4%A/a.png')).toEqual({ kind: 'invalid' })
    expect(classifyPath('/vault-assets/')).toEqual({ kind: 'invalid' })
    expect(classifyPath('/vault-assets//a.png')).toEqual({ kind: 'invalid' })
  })

  it('leaves non-asset paths alone', () => {
    expect(classifyPath('/vault/notes/Home')).toEqual({ kind: 'other' })
    expect(classifyPath('/login')).toEqual({ kind: 'other' })
    expect(classifyPath('/vault-assets')).toEqual({ kind: 'other' })
  })
})

describe('assetAccessStatus', () => {
  const grants: Record<number, string[]> = { 2: ['my-vault'] }
  const has = (userId: number, slug: string) => (grants[userId] ?? []).includes(slug)

  it('401 without a valid session', () => {
    expect(assetAccessStatus('notes', null, has)).toBe(401)
  })

  it('200 for admins on any vault', () => {
    expect(assetAccessStatus('notes', { userId: 1, username: 'a', isAdmin: true }, has)).toBe(200)
  })

  it('200 for a reader on a granted vault, 404 on any other', () => {
    const reader = { userId: 2, username: 'r', isAdmin: false }
    expect(assetAccessStatus('my-vault', reader, has)).toBe(200)
    expect(assetAccessStatus('notes', reader, has)).toBe(404)
  })
})
