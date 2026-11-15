// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'

const refresh = vi.fn()
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/components/i18n/I18nProvider', async () => {
  const { getDict, translate } = await import('@/lib/i18n')
  const dict = getDict('pt-BR')
  return { useI18n: () => ({ t: (k: string) => translate(dict, k) }) }
})

import { PageStatusNotice } from '@/components/viewer/PageStatusNotice'

function respond(states: string[]) {
  let i = 0
  return vi.fn(async () => {
    const state = states[Math.min(i++, states.length - 1)]
    return { ok: true, json: async () => ({ state }) }
  })
}

const el = (mode: 'generating' | 'updating') =>
  React.createElement(PageStatusNotice, { slug: 'v', pagePath: 'Jogos/Fóo bar', mode })

describe('PageStatusNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    refresh.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('pending continua, ready chama refresh', async () => {
    const fetchMock = respond(['pending', 'ready', 'ready'])
    vi.stubGlobal('fetch', fetchMock)
    render(el('generating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).toHaveBeenCalledTimes(1)
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url).toContain('/api/vault/v/page-status?path=')
    expect(url).toContain(encodeURIComponent('Jogos/Fóo bar'))
  })

  it('generating mostra giveUp depois de 5 min', async () => {
    vi.stubGlobal('fetch', respond(['pending']))
    render(el('generating'))
    expect(screen.getByText('Esta página está sendo gerada…')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    expect(screen.getByText('Ainda não ficou pronta. Recarregue a página mais tarde.')).toBeTruthy()
  })

  it('updating some depois de 5 min', async () => {
    vi.stubGlobal('fetch', respond(['pending']))
    const { container } = render(el('updating'))
    expect(screen.getByText('Atualizando esta página…')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000) })
    expect(container.innerHTML).toBe('')
  })

  it('erro de rede não para a consulta', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValue({ ok: true, json: async () => ({ state: 'ready' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(el('updating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('missing chama refresh', async () => {
    vi.stubGlobal('fetch', respond(['missing']))
    render(el('updating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('resposta !ok não para a consulta', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => ({ state: 'ready' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(el('updating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('depois do unmount não há mais fetch', async () => {
    const fetchMock = respond(['pending'])
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = render(el('updating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    unmount()
    const n = fetchMock.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(fetchMock.mock.calls.length).toBe(n)
  })

  it('ready constante: no máximo um refresh em 4 s', async () => {
    vi.stubGlobal('fetch', respond(['ready']))
    render(el('updating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('depois do 3º refresh não há mais fetch e generating mostra giveUp', async () => {
    const fetchMock = respond(['ready'])
    vi.stubGlobal('fetch', fetchMock)
    render(el('generating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Ainda não ficou pronta. Recarregue a página mais tarde.')).toBeTruthy()
    const n = fetchMock.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock.mock.calls.length).toBe(n)
  })

  it('updating some depois do 3º refresh', async () => {
    vi.stubGlobal('fetch', respond(['ready']))
    const { container } = render(el('updating'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(refresh).toHaveBeenCalledTimes(3)
    expect(container.innerHTML).toBe('')
  })
})
