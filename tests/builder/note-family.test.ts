import { describe, it, expect } from 'vitest'
import { parentRef, noteFamilyFields, resolveFamilies, type FamilyNote } from '../../builder/note-family'

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
    expect(noteFamilyFields({ note_type: 'tab', parent: '[[A]]', order: 2, tab_label: ' Jogando ' })).toEqual({
      noteType: 'tab',
      parent: 'A',
      order: 2,
      tabLabel: 'Jogando',
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
  const mae = note('Visões/Visões', { tab_label: 'Jogando' })
  const notes = [
    mae,
    tab('Visões/Zerados', '[[Visões/Visões]]', { order: 2 }),
    tab('Visões/Lista', '[[Visões/Visões]]', { order: 1 }),
    tab('Visões/Arquivo', '[[Visões/Visões]]'),
    note('Outra'),
  ]

  it('mãe primeiro (tab_label), depois order crescente, sem order no fim', () => {
    const f = resolveFamilies(notes)
    expect(f.tabsOf.get('Visões/Visões')).toEqual([
      { path: 'Visões/Visões', label: 'Jogando' },
      { path: 'Visões/Lista', label: 'Lista' },
      { path: 'Visões/Zerados', label: 'Zerados' },
      { path: 'Visões/Arquivo', label: 'Arquivo' },
    ])
  })

  it('cada aba recebe a mesma lista da mãe', () => {
    const f = resolveFamilies(notes)
    const lista = f.tabsOf.get('Visões/Visões')
    for (const p of ['Visões/Lista', 'Visões/Zerados', 'Visões/Arquivo']) {
      expect(f.tabsOf.get(p)).toEqual(lista)
    }
    expect(f.tabsOf.has('Outra')).toBe(false)
  })

  it('abas escondidas, sem página só para comentário', () => {
    const f = resolveFamilies(notes)
    expect([...f.hidden].sort()).toEqual(['Visões/Arquivo', 'Visões/Lista', 'Visões/Zerados'])
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
