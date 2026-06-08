import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import type { VaultsConfigFile } from '@/types'

const REBUILD_TIMEOUT_MS = 300_000
const TAIL_CHARS = 600

function tail(s: string): string {
  return s.length > TAIL_CHARS ? s.slice(-TAIL_CHARS) : s
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  // --- Auth guard (admin-only) ---
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  const payload = token ? await verifyToken(token) : null
  if (!payload) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!payload.isAdmin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const { slug } = await params

  // --- Defense-in-depth: sanitize slug before spawning ---
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Slug inválido' }, { status: 400 })
  }

  // --- Confirm slug exists in config ---
  const filePath = path.join(process.cwd(), 'vaults.config.json')
  let config: VaultsConfigFile
  try {
    config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as VaultsConfigFile
  } catch {
    return NextResponse.json({ error: 'Falha ao ler vaults.config.json' }, { status: 500 })
  }
  if (!config.vaults.some((v) => v.slug === slug)) {
    return NextResponse.json({ error: 'Vault não encontrado' }, { status: 404 })
  }

  // --- Spawn the builder ---
  // slug is already validated against ^[a-zA-Z0-9_-]+$ so it is safe to pass as
  // an argv entry even with shell:true (needed so `npx` resolves on Windows).
  return await new Promise<NextResponse>((resolve) => {
    const child = spawn('npx', ['tsx', 'builder/index.ts', '--vault', slug], {
      cwd: process.cwd(),
      shell: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (res: NextResponse) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(res)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(
        NextResponse.json(
          { ok: false, error: 'Tempo esgotado no rebuild', output: tail(stderr || stdout) },
          { status: 504 },
        ),
      )
    }, REBUILD_TIMEOUT_MS)

    child.stdout?.on('data', (d) => { stdout += d.toString() })
    child.stderr?.on('data', (d) => { stderr += d.toString() })

    child.on('error', (err) => {
      finish(
        NextResponse.json(
          { ok: false, error: 'Falha ao iniciar o rebuild', output: tail(err.message) },
          { status: 500 },
        ),
      )
    })

    child.on('close', (code) => {
      if (code === 0) {
        finish(NextResponse.json({ ok: true, output: tail(stdout) }))
      } else {
        finish(
          NextResponse.json(
            { ok: false, output: tail(stderr || stdout) },
            { status: 500 },
          ),
        )
      }
    })
  })
}
