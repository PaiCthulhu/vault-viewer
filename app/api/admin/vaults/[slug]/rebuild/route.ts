import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { requireAdmin } from '@/lib/admin-guard'
import { runRebuild } from '@/lib/rebuild'
import type { VaultsConfigFile } from '@/types'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  // --- Auth guard (admin-only) ---
  const denied = await requireAdmin()
  if (denied) return denied

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

  // --- Run the builder (per-vault lock lives in lib/rebuild.ts) ---
  // `wait`: a request that lands during another build gets the result of the
  // extra build that covers it, so the UI never reports a build that did not run.
  const r = await runRebuild(slug, { wait: true })
  if (r.ok) return NextResponse.json({ ok: true, output: r.output })
  if (r.timedOut) {
    return NextResponse.json(
      { ok: false, error: 'Tempo esgotado no rebuild', output: r.output },
      { status: 504 },
    )
  }
  return NextResponse.json({ ok: false, output: r.output }, { status: 500 })
}
