import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) redirect('/login')
  const user = await verifyToken(token)
  if (!user) redirect('/login')
  return <>{children}</>
}
