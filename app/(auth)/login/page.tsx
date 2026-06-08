import { getT } from '@/lib/i18n/server'
import { ConstellationCanvas } from '@/components/login/ConstellationCanvas'
import { LoginForm } from '@/components/login/LoginForm'
import { ThemeToggle } from '@/components/shared/ThemeToggle'

export default async function LoginPage() {
  const t = await getT()
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel — constellation */}
      <div className="relative hidden flex-[0_0_58%] overflow-hidden bg-[#05050f] sm:flex">
        <ConstellationCanvas />
        <div className="relative z-10 flex h-full w-full flex-col items-end justify-center px-12 py-14 text-right">
          <h1 className="mb-3.5 text-5xl font-extrabold leading-none tracking-tighter text-white">
            {t('login.title')}
          </h1>
          <p className="max-w-xs text-[0.95rem] leading-relaxed text-white/38">
            {t('login.tagline')}
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div
        className="relative flex flex-1 flex-col items-stretch justify-center border-l border-white/[0.06] px-16"
        style={{ background: 'var(--bg-secondary)' }}
      >
        <ThemeToggle className="absolute right-5 top-4" />
        <LoginForm />
      </div>
    </div>
  )
}
