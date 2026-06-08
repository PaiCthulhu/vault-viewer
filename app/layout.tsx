import 'katex/dist/katex.min.css'
import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { I18nProvider } from '@/components/i18n/I18nProvider'
import { getLocale } from '@/lib/i18n/server'
import './globals.css'

export const metadata: Metadata = {
  title: 'Vault Viewer',
  description: 'Your private knowledge space',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <I18nProvider locale={locale}>{children}</I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
