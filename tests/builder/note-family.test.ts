import { describe, it, expect } from 'vitest'
import { parentRef, noteFamilyFields, resolveFamilies, isInCommentsFolder, type FamilyNote } from '../../builder/note-family'

function note(path: string, frontmatter: Record<string, unknown> = {}, title?: string): FamilyNote {
  return { path, title: title ?? path.split('/').pop()!, frontmatter }
}

const tab = (path: string, parent: string, extra: Record<string, unknown> = {}, title?: string) =>
  note(path, { note_type: 'tab', parent, ...extra }, title)

describe('parentRef', () => {
  it.each([
    ['[[Pasta/Mãe]]'],
    ['[[Pasta/Mãe|apelido]]'],
    ['[[Pasta/Mãe#Seção]]'],
    ['Pasta/Mãe'],
    ['Pasta/Mãe.md'],
    ['[[Pasta/Mãe.md]]'],
    ['/Pasta/Mãe'],
    ['  [[ Pasta/Mãe ]]  '],
  ])('%s → Pasta/Mãe', v => {
    expect(parentRef(v)).toBe('Pasta/Mãe')
  })

  it.each([
    [[['Pasta/Mãe']]], // YAML sem aspas: [[X]] vira lista
    [42],
    [''],
    ['   '],
    ['[[]]'],
    [null],
    [undefined],
  ])('%j → null', v => {
    expect(parentRef(v)).toBeNull()
  })
})

describe('noteFamilyFields', () => {
  it('lê os quatro campos', () => {
    expect(noteFamilyFields({ note_type: 'tab', parent: '[[A]]', order: 2, tab_label: ' Panorama ' })).toEqual({
      noteType: 'tab',
      parent: 'A',
      order: 2,
      tabLabel: 'Panorama',
    })
  })

  it('note_type desconhecido ou ausente é null', () => {
    expect(noteFamilyFields({ note_type: 'section', parent: '[[A]]' }).noteType).toBeNull()
    expect(noteFamilyFields({ note_type: 'character' }).noteType).toBeNull()
    expect(noteFamilyFields({}).noteType).toBeNull()
  })

  it('order só vale inteiro', () => {
    expect(noteFamilyFields({ order: -3 }).order).toBe(-3)
    expect(noteFamilyFields({ order: '2' }).order).toBeNull()
    expect(noteFamilyFields({ order: 1.5 }).order).toBeNull()
  })

  it('tab_label vazio é null; número vira texto', () => {
    expect(noteFamilyFields({ tab_label: '   ' }).tabLabel).toBeNull()
    expect(noteFamilyFields({ tab_label: 2024 }).tabLabel).toBe('2024')
  })
})

describe('resolveFamilies — abas', () => {
  const mae = note('Ômega/Ômega', { tab_label: 'Panorama' })
  const notes = [
    mae,
    tab('Ômega/Sumário', '[[Ômega/Ômega]]', { order: 2 }),
    tab('Ômega/Lista', '[[Ômega/Ômega]]', { order: 1 }),
    tab('Ômega/Arquivo', '[[Ômega/Ômega]]'),
    note('Outra'),
  ]

  it('mãe primeiro (tab_label), depois order crescente, sem order no fim', () => {
    const f = resolveFamilies(notes)
    expect(f.tabsOf.get('Ômega/Ômega')).toEqual([
      { path: 'Ômega/Ômega', label: 'Panorama' },
      { path: 'Ômega/Lista', label: 'Lista' },
      { path: 'Ômega/Sumário', label: 'Sumário' },
      { path: 'Ômega/Arquivo', label: 'Arquivo' },
    ])
  })

  it('cada aba recebe a mesma lista da mãe', () => {
    const f = resolveFamilies(notes)
    const lista = f.tabsOf.get('Ômega/Ômega')
    for (const p of ['Ômega/Lista', 'Ômega/Sumário', 'Ômega/Arquivo']) {
      expect(f.tabsOf.get(p)).toEqual(lista)
    }
    expect(f.tabsOf.has('Outra')).toBe(false)
  })

  it('abas escondidas, sem página só para comentário', () => {
    const f = resolveFamilies(notes)
    expect([...f.hidden].sort()).toEqual(['Ômega/Arquivo', 'Ômega/Lista', 'Ômega/Sumário'])
    expect(f.noPage.size).toBe(0)
  })

  it('sem tab_label, o rótulo da mãe é o título dela', () => {
    const f = resolveFamilies([note('M', {}, 'Título da Mãe'), tab('A', '[[M]]')])
    expect(f.tabsOf.get('M')![0]).toEqual({ path: 'M', label: 'Título da Mãe' })
  })

  it('o rótulo da aba é o título dela (titleProperty), não o tab_label dela', () => {
    const f = resolveFamilies([note('M'), tab('A', '[[M]]', { tab_label: 'Ignorado' }, 'Título A')])
    expect(f.tabsOf.get('M')![1]).toEqual({ path: 'A', label: 'Título A' })
  })

  it('empate de order: título, depois caminho', () => {
    const f = resolveFamilies([
      note('M'),
      tab('z/B', '[[M]]', { order: 1 }, 'Beta'),
      tab('y/B', '[[M]]', { order: 1 }, 'Beta'),
      tab('x/A', '[[M]]', { order: 1 }, 'Alfa'),
      tab('w/S1', '[[M]]', {}, 'Sem'),
      tab('v/S0', '[[M]]', {}, 'Antes'),
    ])
    expect(f.tabsOf.get('M')!.map(t => t.path)).toEqual(['M', 'x/A', 'y/B', 'z/B', 'v/S0', 'w/S1'])
  })

  it('parent casa por caminho exato sem diferenciar caixa', () => {
    const f = resolveFamilies([note('Pasta/Mãe'), tab('Pasta/A', '[[pasta/MÃE]]')])
    expect(f.tabsOf.get('Pasta/Mãe')!.map(t => t.path)).toEqual(['Pasta/Mãe', 'Pasta/A'])
  })

  it('parent não casa por nome solto nem por sufixo', () => {
    const f = resolveFamilies([note('Pasta/Mãe'), tab('Pasta/A', '[[Mãe]]')])
    expect(f.hidden.size).toBe(0)
    expect(f.tabsOf.size).toBe(0)
  })

  it('mãe sem aba válida não tem barra', () => {
    const f = resolveFamilies([note('M', { tab_label: 'X' }), note('A', { note_type: 'tab' })])
    expect(f.tabsOf.size).toBe(0)
  })
})

describe('resolveFamilies — abas que viram nota comum', () => {
  const comum = (f: ReturnType<typeof resolveFamilies>, p: string) => {
    expect(f.hidden.has(p)).toBe(false)
    expect(f.noPage.has(p)).toBe(false)
    expect(f.tabsOf.has(p)).toBe(false)
  }

  it('aba órfã (parent não resolve)', () => {
    const f = resolveFamilies([tab('A', '[[Não Existe]]')])
    comum(f, 'A')
  })

  it('aba que aponta para si mesma', () => {
    const f = resolveFamilies([tab('A', '[[A]]')])
    comum(f, 'A')
  })

  it('ciclo A↔B: as duas viram nota comum', () => {
    const f = resolveFamilies([tab('A', '[[B]]'), tab('B', '[[A]]')])
    comum(f, 'A')
    comum(f, 'B')
  })

  it('aba de aba (G←M←T): M é aba de G, T é nota comum', () => {
    const f = resolveFamilies([note('G'), tab('M', '[[G]]'), tab('T', '[[M]]')])
    expect(f.hidden.has('M')).toBe(true)
    expect(f.tabsOf.get('G')!.map(t => t.path)).toEqual(['G', 'M'])
    comum(f, 'T')
  })

  it('aba cuja mãe é comentário', () => {
    const f = resolveFamilies([note('N'), note('C', { note_type: 'comment', parent: '[[N]]' }), tab('T', '[[C]]')])
    comum(f, 'T')
  })

  it('a mãe de uma aba pode ser uma aba órfã (que é nota comum)', () => {
    const f = resolveFamilies([tab('M', '[[Sumiu]]'), tab('T', '[[M]]')])
    expect(f.hidden.has('M')).toBe(false)
    expect(f.tabsOf.get('M')!.map(t => t.path)).toEqual(['M', 'T'])
  })
})

describe('resolveFamilies — comentários', () => {
  it('comentário com parent que resolve: escondido e sem página', () => {
    const f = resolveFamilies([note('N'), note('_comments/N/c1', { note_type: 'comment', parent: '[[N]]' })])
    expect(f.hidden.has('_comments/N/c1')).toBe(true)
    expect(f.noPage.has('_comments/N/c1')).toBe(true)
    expect(f.tabsOf.size).toBe(0)
  })

  it('comentário órfão também some', () => {
    const f = resolveFamilies([note('_comments/X/c1', { note_type: 'comment', parent: '[[X]]' })])
    expect(f.hidden.has('_comments/X/c1')).toBe(true)
    expect(f.noPage.has('_comments/X/c1')).toBe(true)
  })

  it('comentário sem parent é nota comum', () => {
    const f = resolveFamilies([note('C', { note_type: 'comment' })])
    expect(f.hidden.size).toBe(0)
    expect(f.noPage.size).toBe(0)
  })

  it('comentário com parent vazio é nota comum (é o mesmo que não ter parent)', () => {
    const f = resolveFamilies([
      note('C1', { note_type: 'comment', parent: '' }),
      note('C2', { note_type: 'comment', parent: '   ' }),
      note('C3', { note_type: 'comment', parent: null }),
      note('C4', { note_type: 'comment', parent: [] }),
    ])
    expect(f.hidden.size).toBe(0)
    expect(f.noPage.size).toBe(0)
  })

  it('comentário com parent fora do formato (lista, número) é órfão: some, nunca vira página', () => {
    const f = resolveFamilies([
      note('N'),
      // `parent: [[N]]` sem aspas: o YAML lê lista de lista.
      note('C1', { note_type: 'comment', parent: [['N']] }),
      // Propriedade do tipo Lista no Obsidian.
      note('C2', { note_type: 'comment', parent: ['[[N]]'] }),
      note('C3', { note_type: 'comment', parent: 2024 }),
    ])
    for (const p of ['C1', 'C2', 'C3']) {
      expect(f.hidden.has(p)).toBe(true)
      expect(f.noPage.has(p)).toBe(true)
    }
  })
})

describe('resolveFamilies — caixa', () => {
  it('com duas notas que só diferem na caixa, o parent exato ganha', () => {
    const f = resolveFamilies([note('P/M'), note('P/m'), tab('A', '[[P/M]]'), tab('B', '[[P/m]]')])
    expect(f.tabsOf.get('P/M')!.map(t => t.path)).toEqual(['P/M', 'A'])
    expect(f.tabsOf.get('P/m')!.map(t => t.path)).toEqual(['P/m', 'B'])
  })
})

describe('isInCommentsFolder', () => {
  it.each([
    ['_comments/x'],
    ['_comments/Notas/Mãe/2026-11-16 120000 ana-k3f9'],
    ['_Comments/a/b/c'],
    ['_COMMENTS/x'],
  ])('%s → dentro', p => {
    expect(isInCommentsFolder(p)).toBe(true)
  })

  it.each([
    ['_comments'], // `_comments.md` na raiz
    ['Notas/_comments/x'],
    ['_commentsX/y'],
    ['_comment/x'],
    ['x/_comments'],
    ['_comments/'],
    [''],
  ])('%s → fora', p => {
    expect(isInCommentsFolder(p)).toBe(false)
  })
})

describe('resolveFamilies — pasta _comments/', () => {
  const ignorado = (f: ReturnType<typeof resolveFamilies>, p: string) => {
    expect(f.hidden.has(p), p).toBe(true)
    expect(f.noPage.has(p), p).toBe(true)
    expect(f.comments.has(p), p).toBe(false)
    expect(f.tabsOf.has(p), p).toBe(false)
  }

  it('comentário válido entra em comments, dentro ou fora da pasta', () => {
    const f = resolveFamilies([
      note('N'),
      note('_comments/N/c1', { note_type: 'comment', parent: '[[N]]' }),
      note('Outra/c2', { note_type: 'comment', parent: '[[N]]' }),
      note('_comments/X/orfao', { note_type: 'comment', parent: '[[Não Existe]]' }),
    ])
    expect([...f.comments].sort()).toEqual(['Outra/c2', '_comments/N/c1', '_comments/X/orfao'])
    for (const p of f.comments) {
      expect(f.hidden.has(p)).toBe(true)
      expect(f.noPage.has(p)).toBe(true)
    }
  })

  it('o que não é comentário válido dentro da pasta é ignorado, em qualquer caixa e profundidade', () => {
    const f = resolveFamilies([
      note('N', { status: 'x' }),
      note('_comments/N/sem-frontmatter'),
      note('_Comments/a/b/c'),
      note('_COMMENTS/N/outro-tipo', { note_type: 'character', parent: '[[N]]' }),
      note('_comments/N/sem-parent', { note_type: 'comment' }),
      note('_comments/N/parent-vazio', { note_type: 'comment', parent: '  ' }),
    ])
    for (const p of [
      '_comments/N/sem-frontmatter',
      '_Comments/a/b/c',
      '_COMMENTS/N/outro-tipo',
      '_comments/N/sem-parent',
      '_comments/N/parent-vazio',
    ]) {
      ignorado(f, p)
    }
    expect(f.comments.size).toBe(0)
    expect(f.hidden.has('N')).toBe(false)
  })

  it('fora da raiz, ou o próprio _comments.md, continua nota comum', () => {
    const f = resolveFamilies([note('Notas/_comments/x'), note('_comments'), note('_commentsX/y')])
    expect(f.hidden.size).toBe(0)
    expect(f.noPage.size).toBe(0)
    expect(f.comments.size).toBe(0)
  })

  it('aba dentro da pasta é ignorada: a mãe não ganha barra', () => {
    const f = resolveFamilies([note('M', { status: 'x' }), tab('_comments/M/aba', '[[M]]')])
    ignorado(f, '_comments/M/aba')
    expect(f.tabsOf.size).toBe(0)
  })

  it('aba dentro da pasta não entra na barra de uma mãe que tem abas válidas', () => {
    const f = resolveFamilies([note('M'), tab('Abas/A', '[[M]]'), tab('_comments/M/aba', '[[M]]', { order: 1 })])
    expect(f.tabsOf.get('M')!.map(t => t.path)).toEqual(['M', 'Abas/A'])
    ignorado(f, '_comments/M/aba')
  })

  it('aba fora da pasta cuja mãe é um ignorado vira nota comum', () => {
    const f = resolveFamilies([note('_comments/M/ignorado'), tab('T', '[[_comments/M/ignorado]]')])
    ignorado(f, '_comments/M/ignorado')
    expect(f.hidden.has('T')).toBe(false)
    expect(f.noPage.has('T')).toBe(false)
    expect(f.tabsOf.size).toBe(0)
  })
})
