// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/I18nProvider', async () => {
  const { getDict, translate } = await import('@/lib/i18n')
  const dict = getDict('pt-BR')
  return {
    useI18n: () => ({
      t: (k: string, vars?: Record<string, string | number>) => translate(dict, k, vars),
    }),
  }
})

// A página do admin inteira, sem a barra do topo e a lateral (precisam do router do Next)
vi.mock('@/components/shared/Topbar', () => ({ Topbar: () => null }))
vi.mock('@/components/admin/AdminSidebar', () => ({ AdminSidebar: () => null }))

import { UserDetailPanel } from '@/components/admin/UserDetailPanel'
import { UsersTable } from '@/components/admin/UsersTable'
import { AdminPageClient } from '@/components/admin/AdminPageClient'
import type { UserPublic, VaultConfig } from '@/types'

const vaults = [
  { slug: 'my-vault', name: 'my-vault' },
  { slug: 'test-vault', name: 'test-vault' },
] as VaultConfig[]

const user = (extra: Partial<UserPublic> = {}): UserPublic => ({
  id: 1,
  username: 'ana',
  displayName: null,
  isAdmin: false,
  createdAt: '2026-01-01',
  vaults: [],
  ...extra,
})

type Call = { url: string; method: string; body: unknown }
let calls: Call[]
let respond: (c: Call) => { status: number; json: unknown }

beforeEach(() => {
  calls = []
  respond = () => ({ status: 200, json: { success: true } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const c = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined }
      calls.push(c)
      const r = respond(c)
      return { ok: r.status < 400, status: r.status, json: async () => r.json }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const radio = (vault: string, label: string) =>
  within(screen.getByRole('radiogroup', { name: vault })).getByRole('radio', { name: label })

// Inputs do painel, na ordem: usuário, nome de exibição, senha
function fillNewUser(container: HTMLElement, username: string, password: string) {
  const inputs = container.querySelectorAll('input')
  fireEvent.change(inputs[0], { target: { value: username } })
  fireEvent.change(inputs[2], { target: { value: password } })
}

// POST cria com ids 7, 8, ...; o PUT de permissões do id 7 falha, os outros passam
function partialCreateResponder() {
  let nextId = 7
  return (c: Call) => {
    if (c.url === '/api/admin/users' && c.method === 'POST') {
      return { status: 201, json: { user: { id: nextId++, username: (c.body as { username: string }).username } } }
    }
    if (c.url === '/api/admin/users' && c.method === 'GET') return { status: 200, json: { users: [] } }
    if (c.url === '/api/admin/users/7/permissions') return { status: 400, json: { error: 'ruim' } }
    return { status: 200, json: {} }
  }
}

describe('UserDetailPanel', () => {
  it('mostra o nível atual de cada vault', () => {
    render(
      <UserDetailPanel
        user={user({ vaults: [{ slug: 'my-vault', level: 'editor' }] })}
        vaults={vaults}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    expect(radio('my-vault', 'Editor').getAttribute('aria-checked')).toBe('true')
    expect(radio('test-vault', 'Sem acesso').getAttribute('aria-checked')).toBe('true')
    expect(radio('test-vault', 'Editor').getAttribute('aria-checked')).toBe('false')
  })

  it('salvar manda os níveis escolhidos', async () => {
    const onSaved = vi.fn()
    render(
      <UserDetailPanel
        user={user({ vaults: [{ slug: 'my-vault', level: 'editor' }] })}
        vaults={vaults}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )
    fireEvent.click(radio('test-vault', 'Leitor'))
    fireEvent.click(radio('my-vault', 'Sem acesso'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const put = calls.find((c) => c.url === '/api/admin/users/1/permissions')!
    expect(put.method).toBe('PUT')
    expect(put.body).toEqual({ vaults: [{ slug: 'test-vault', level: 'reader' }] })
  })

  it('PUT de permissões que falha mostra o erro e não fecha', async () => {
    respond = (c) =>
      c.url.endsWith('/permissions') ? { status: 500, json: { error: 'falhou' } } : { status: 200, json: {} }
    const onSaved = vi.fn()
    render(<UserDetailPanel user={user()} vaults={vaults} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('O acesso aos vaults não foi salvo: falhou')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('criação com permissões que falham não cria de novo no próximo salvar', async () => {
    respond = (c) => {
      if (c.url === '/api/admin/users' && c.method === 'POST') return { status: 201, json: { user: { id: 7 } } }
      if (c.url === '/api/admin/users/7/permissions') return { status: 400, json: { error: 'ruim' } }
      return { status: 200, json: {} }
    }
    const onSaved = vi.fn()
    const { container } = render(
      <UserDetailPanel user={null} vaults={vaults} onClose={vi.fn()} onSaved={onSaved} />,
    )
    const inputs = container.querySelectorAll('input')
    fireEvent.change(inputs[0], { target: { value: 'bia' } })
    fireEvent.change(inputs[2], { target: { value: 'segredo' } })
    fireEvent.click(radio('my-vault', 'Leitor'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('Usuário criado, mas o acesso aos vaults não foi salvo: ruim')
    expect(onSaved).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/users/7' && c.method === 'PUT')).toBe(true))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/admin/users/7/permissions')).toHaveLength(2))
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onSaved).toHaveBeenCalled()
  })

  it('depois de uma criação parcial o painel mostra o título e os rótulos de edição', async () => {
    respond = partialCreateResponder()
    const { container } = render(
      <UserDetailPanel user={null} vaults={vaults} onClose={vi.fn()} onSaved={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: 'Novo usuário' })).toBeTruthy()
    expect(screen.getByText('Senha')).toBeTruthy()
    fillNewUser(container, 'bia', 'segredo')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('Usuário criado, mas o acesso aos vaults não foi salvo: ruim')
    expect(screen.getByRole('heading', { name: 'Editar — bia' })).toBeTruthy()
    expect(screen.getByText('Nova senha (em branco = manter)')).toBeTruthy()
    expect(screen.queryByText('Senha')).toBeNull()
  })

  it('vault com slug de Object.prototype mostra e salva o nível', async () => {
    const protoVaults = [
      { slug: 'constructor', name: 'constructor' },
      { slug: '__proto__', name: '__proto__' },
      { slug: 'toString', name: 'toString' },
    ] as VaultConfig[]
    const onSaved = vi.fn()
    render(
      <UserDetailPanel
        user={user({ vaults: [{ slug: 'toString', level: 'editor' }] })}
        vaults={protoVaults}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )
    expect(radio('constructor', 'Sem acesso').getAttribute('aria-checked')).toBe('true')
    expect(radio('__proto__', 'Sem acesso').getAttribute('aria-checked')).toBe('true')
    expect(radio('toString', 'Editor').getAttribute('aria-checked')).toBe('true')

    fireEvent.click(radio('constructor', 'Leitor'))
    fireEvent.click(radio('__proto__', 'Editor'))
    expect(radio('constructor', 'Leitor').getAttribute('aria-checked')).toBe('true')
    expect(radio('__proto__', 'Editor').getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const put = calls.find((c) => c.url === '/api/admin/users/1/permissions')!
    expect(put.body).toEqual({
      vaults: [
        { slug: 'toString', level: 'editor' },
        { slug: 'constructor', level: 'reader' },
        { slug: '__proto__', level: 'editor' },
      ],
    })
  })

  it('fetch que lança mostra erro de rede e não fecha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const onSaved = vi.fn()
    render(<UserDetailPanel user={user()} vaults={vaults} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('Erro de rede ao salvar')
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('UsersTable', () => {
  it('a tabela marca o vault em que o usuário é editor', () => {
    render(
      <UsersTable
        users={[user({ vaults: [{ slug: 'my-vault', level: 'editor' }, { slug: 'test-vault', level: 'reader' }] })]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('my-vault').textContent).toContain('editor')
    expect(screen.getByText('test-vault').textContent).not.toContain('editor')
  })

  it('a coluna Função mostra Usuário para quem não é admin e Admin para o admin', () => {
    render(
      <UsersTable
        users={[user({ id: 1, username: 'ana' }), user({ id: 2, username: 'root', isAdmin: true })]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    // a linha 0 é o cabeçalho; a Função é a segunda célula
    const [, ana, root] = screen.getAllByRole('row')
    expect(within(ana).getAllByRole('cell')[1].textContent).toBe('Usuário')
    expect(within(root).getAllByRole('cell')[1].textContent).toBe('Admin')
    expect(screen.queryByText('Leitor')).toBeNull()
  })

  it('em inglês a coluna Função mostra User', async () => {
    const { getDict, translate } = await import('@/lib/i18n')
    expect(translate(getDict('en'), 'admin.users.roleUser')).toBe('User')
    expect(translate(getDict('pt-BR'), 'admin.users.roleUser')).toBe('Usuário')
  })
})

describe('AdminPageClient', () => {
  it('"+ Novo usuário" depois de uma criação parcial abre um painel limpo e cria outro usuário', async () => {
    respond = partialCreateResponder()
    const { container } = render(
      <AdminPageClient initialUsers={[]} vaults={vaults} currentUsername="root" isAdmin />,
    )
    fireEvent.click(screen.getByRole('button', { name: '+ Novo usuário' }))
    fillNewUser(container, 'bia', 'segredo')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await screen.findByText('Usuário criado, mas o acesso aos vaults não foi salvo: ruim')

    fireEvent.click(screen.getByRole('button', { name: '+ Novo usuário' }))
    expect(screen.getByRole('heading', { name: 'Novo usuário' })).toBeTruthy()
    expect(screen.queryByText('Usuário criado, mas o acesso aos vaults não foi salvo: ruim')).toBeNull()
    const inputs = container.querySelectorAll('input')
    expect(inputs[0].value).toBe('')
    expect(inputs[2].value).toBe('')

    fillNewUser(container, 'caio', 'outra')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2))
    expect(calls.filter((c) => c.method === 'POST')[1].body).toMatchObject({ username: 'caio', password: 'outra' })
    expect(calls.some((c) => c.url === '/api/admin/users/7' && c.method === 'PUT')).toBe(false)
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/users/8/permissions')).toBe(true))
  })
})
