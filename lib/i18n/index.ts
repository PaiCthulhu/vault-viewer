// Lightweight i18n. To add a language: copy `en.ts` to e.g. `de.ts`, translate
// the values, and register it in LOCALES below. The browser's language is used
// on first visit when a matching locale exists; otherwise it falls back to
// DEFAULT_LOCALE. A per-user override is stored in the `vault_locale` cookie.

import { en } from './en'
import { ptBR } from './pt-BR'

export type Dict = Record<string, string>

export interface Locale {
  code: string // BCP-47-ish code, e.g. "en", "pt-BR"
  label: string // shown in the language switcher
  dict: Dict
}

export const LOCALES: Locale[] = [
  { code: 'en', label: 'English', dict: en },
  { code: 'pt-BR', label: 'Português (BR)', dict: ptBR },
]

export const DEFAULT_LOCALE = 'en'
export const LOCALE_COOKIE = 'vault_locale'

export function getDict(code: string): Dict {
  return (
    LOCALES.find(l => l.code === code)?.dict ??
    LOCALES.find(l => l.code === DEFAULT_LOCALE)!.dict
  )
}

export function isKnownLocale(code: string | undefined | null): boolean {
  return !!code && LOCALES.some(l => l.code === code)
}

// Picks the locale: an explicit (cookie) choice wins; otherwise the best match
// against the Accept-Language header among registered locales; else the default.
// Matching is plug-and-play: future locales are matched automatically.
export function resolveLocale(cookieLocale?: string, acceptLanguage?: string): string {
  if (isKnownLocale(cookieLocale)) return cookieLocale as string
  if (acceptLanguage) {
    const wanted = acceptLanguage
      .split(',')
      .map(s => s.split(';')[0].trim())
      .filter(Boolean)
    for (const w of wanted) {
      const exact = LOCALES.find(l => l.code.toLowerCase() === w.toLowerCase())
      if (exact) return exact.code
      const primary = w.split('-')[0].toLowerCase()
      const byPrimary = LOCALES.find(l => l.code.split('-')[0].toLowerCase() === primary)
      if (byPrimary) return byPrimary.code
    }
  }
  return DEFAULT_LOCALE
}

// Looks up `key` in `dict` (falls back to the key itself) and interpolates
// `{var}` placeholders.
export function translate(
  dict: Dict,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let s = dict[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v))
    }
  }
  return s
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string
