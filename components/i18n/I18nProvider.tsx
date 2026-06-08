'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getDict, translate, LOCALE_COOKIE, LOCALES, type TFunc, type Locale } from '@/lib/i18n'

interface I18nContextValue {
  locale: string
  t: TFunc
  setLocale: (code: string) => void
  locales: Locale[]
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  locale,
  children,
}: {
  locale: string
  children: React.ReactNode
}) {
  const [loc, setLoc] = useState(locale)
  const router = useRouter()
  const dict = getDict(loc)

  const t = useCallback<TFunc>((key, vars) => translate(dict, key, vars), [dict])

  const setLocale = useCallback(
    (code: string) => {
      // Persist the choice for ~1 year and re-render server components with it.
      document.cookie = `${LOCALE_COOKIE}=${code};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`
      setLoc(code)
      router.refresh()
    },
    [router],
  )

  return (
    <I18nContext.Provider value={{ locale: loc, t, setLocale, locales: LOCALES }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
