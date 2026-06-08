export interface VaultConfig {
  slug: string
  name: string
  path: string
  description: string
  homePage: string
  coverImage: string | null
  // When set, the builder uses this frontmatter property as each page's display
  // title (falling back to the filename when the property is missing/empty).
  // When null/absent, the filename is the title.
  titleProperty?: string | null
  // Frontmatter property holding the banner/cover image (e.g. "cover" or
  // "banner"). The builder also reads `${coverProperty}_y` / `${coverProperty}_x`
  // for the focal position. When null/absent, the builder tries "cover" then
  // "banner".
  coverProperty?: string | null
}

export interface VaultsConfigFile {
  vaults: VaultConfig[]
}

export interface JWTPayload {
  userId: number
  username: string
  isAdmin: boolean
}

export interface UserRow {
  id: number
  username: string
  password_hash: string
  is_admin: number // SQLite stores boolean as 0 or 1
  created_at: string
}

export interface UserPublic {
  id: number
  username: string
  isAdmin: boolean
  createdAt: string
  vaultSlugs: string[]
}
