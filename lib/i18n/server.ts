// Server-side locale resolution for Server Components. Reads the per-user cookie
// and the request's Accept-Language header.
import { cookies, headers } from 'next/headers'
import { resolveLocale, getDict, translate, LOCALE_COOKIE, type TFunc } from './index'

export async function getLocale(): Promise<string> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value
  const acceptLanguage = (await headers()).get('accept-language') ?? undefined
  return resolveLocale(cookieLocale, acceptLanguage)
}

export async function getT(): Promise<TFunc> {
  const dict = getDict(await getLocale())
  return (key, vars) => translate(dict, key, vars)
}
