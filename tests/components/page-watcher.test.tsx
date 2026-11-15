// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

const refresh = vi.fn()
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

import { PageWatcher } from '@/components/viewer/PageWatcher'

let vis: 'visible' | 'hidden' = 'visible'

function respond(version: string) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ version, building: false }) }))
}

const el = (version: string, pagePath = 'Jogos/Foo') =>
  React.createElement(PageWatcher, { slug: 'v', pagePath, version })

describe('PageWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    refresh.mockReset()
    vis = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('consulta a rota com o caminho codificado', async () => {
    const fetchMock = respond('v1')
    vi.stubGlobal('fetch', fetchMock)
    const p = 'Views/Atualização Pendente #1 %'
    render(el('v1', p))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('/api/vault/v/page-version?path=' + encodeURIComponent(p))
    expect(init.cache).toBe('no-store')
  })

  it('versão nova chama router.refresh', async () => {
    vi.stubGlobal('fetch', respond('v2'))
    render(el('v1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('rerender com a versão nova não chama de novo', async () => {
    vi.stubGlobal('fetch', respond('v2'))
    const { rerender } = render(el('v1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(refresh).toHaveBeenCalledTimes(1)
    rerender(el('v2'))
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
    // O conteúdo volta para v1: só refaz se a versão renderizada foi sincronizada em v2 (setVersion).
    vi.stubGlobal('fetch', respond('v1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('corpo 200 fora do formato não dá refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    render(el('v1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('requisição que nunca responde é abandonada após 10 s e a consulta seguinte acontece', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
    vi.stubGlobal('fetch', fetchMock)
    render(el('v1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(130_000) })
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('voltar para a aba consulta na hora', async () => {
    vis = 'hidden'
    const fetchMock = respond('v1')
    vi.stubGlobal('fetch', fetchMock)
    render(el('v1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).not.toHaveBeenCalled()
    vis = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('desmontar para tudo', async () => {
    const fetchMock = respond('v1')
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(el('v1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const n = fetchMock.mock.calls.length
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(fetchMock.mock.calls.length).toBe(n)
  })
})
