// @vitest-environment jsdom
// jsdom because FamilyStore's messages come from i18n, which reads the language setting from localStorage.
import { describe, expect, it } from 'vitest'
import { type People, type Person, age, byBirth, datesDecide, reorderValues, childrenByCoParent, emptyFields, formatPhone, halfSiblingVia, isDeceased, isValidEmail, isValidPartialDate, isValidPhone, lifespan, normalizePerson, normalizePhone, rankPeople, rootAncestors, yearsBetween, searchPeople, seniorAncestor, siblingsOf, partnerIds, partnersOf } from '../src/model'
import { applyOp, simulate, type ChangeRecord, type NewChange, type Op } from '../src/ops'
import { FamilyStore } from '../src/store'
import { seedToPeople } from '../src/seed-format'

/** In-memory backend mirroring what the Worker does: compute diffs, apply ops, log. */
function memoryStore(seed: Person[]) {
  const people: People = new Map(seed.map(p => [p.id, p]))
  const changes: ChangeRecord[] = []
  const store: FamilyStore = new FamilyStore(async (ops: Op[], change: NewChange) => {
    const diffs = simulate(people, ops)
    for (const op of ops) applyOp(people, op)
    changes.push({ ...change, diffs, id: String(changes.length + 1), at: Date.now() })
    store.setPeople([...people.values()])
  })
  store.setPeople(seed)
  return { store, people, changes }
}

const person = (id: string, extra: Partial<Person> = {}): Person =>
  ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, parentKinds: {}, order: 0, ...extra })

function family() {
  return [
    person('dad', { nameZh: '爸', gender: 'M', spouses: ['mom', 'mom2'] }),
    person('mom', { nameZh: '媽', gender: 'F', spouses: ['dad'] }),
    person('mom2', { nameZh: '繼母', gender: 'F', spouses: ['dad'] }),
    person('a', { nameZh: '甲', nameEn: 'Alice', parents: ['dad', 'mom'], birthDate: '1990', order: 2 }),
    person('b', { nameZh: '乙', otherNames: '小乙, Bee', parents: ['dad', 'mom'], birthDate: '1985', order: 1 }),
    person('c', { nameZh: '丙', parents: ['dad', 'mom2'] }),
  ]
}

describe('model', () => {
  it('computes ages from partial dates', () => {
    const today = new Date(2026, 10, 17) // 2026-11-17
    const at = (birthDate: string, deathDate = '') => age(person('x', { birthDate, deathDate }), today)
    expect(at('')).toBeNull()
    expect(at('1993-03-14')).toEqual({ years: 33, approx: false, atDeath: false })
    expect(at('1993-11-18')).toEqual({ years: 32, approx: false, atDeath: false })
    expect(at('1993-11')).toEqual({ years: 33, approx: true, atDeath: false })
    expect(at('1993-10')).toEqual({ years: 33, approx: false, atDeath: false })
    expect(at('1993')).toEqual({ years: 33, approx: true, atDeath: false })
    expect(at('1920-03-01', '1990-02-28')).toEqual({ years: 69, approx: false, atDeath: true })
    expect(at('1920', '1990')).toEqual({ years: 70, approx: true, atDeath: true })
    expect(at('1900')).toEqual({ years: 126, approx: true, atDeath: false })
    expect(at('1900', '1980')).toEqual({ years: 80, approx: true, atDeath: true })
  })

  it('computes whole years between partial dates', () => {
    expect(yearsBetween('1990-03-14', '2000-03-14')).toEqual({ years: 10, approx: false })
    expect(yearsBetween('1990-03-14', '2000-03-13')).toEqual({ years: 9, approx: false })
    expect(yearsBetween('1990', '2000-06-01')).toEqual({ years: 10, approx: true })
    expect(yearsBetween('1990-03', '2000-03-10')).toEqual({ years: 10, approx: true })
    expect(yearsBetween('1990-03-14', new Date(2026, 10, 19))).toEqual({ years: 36, approx: false })
    expect(yearsBetween('2000', '1990')).toBeNull()
    expect(yearsBetween('', '1990')).toBeNull()
    expect(yearsBetween('1990', 'bad')).toBeNull()
  })

  it('treats deceased with no death date as having no age', () => {
    const today = new Date(2026, 10, 18)
    const p = (extra: Partial<Person>) => person('x', extra)
    expect(age(p({ birthDate: '1900', deceased: 'yes' }), today)).toBeNull()
    expect(age(p({ birthDate: '1900', deathDate: '1980', deceased: 'yes' }), today)).toEqual({ years: 80, approx: true, atDeath: true })
    expect(age(p({ birthDate: '1990' }), today)).toEqual({ years: 36, approx: true, atDeath: false })
  })

  it('knows who is deceased', () => {
    expect(isDeceased(person('x'))).toBe(false)
    expect(isDeceased(person('x', { deceased: 'yes' }))).toBe(true)
    expect(isDeceased(person('x', { deathDate: '1980' }))).toBe(true)
  })

  it('normalizes deceased and shows an unknown death year as ?', () => {
    expect(normalizePerson('p', {}).deceased).toBe('')
    expect(normalizePerson('p', { deceased: 'yes' }).deceased).toBe('yes')
    for (const bad of ['no', 'YES', true, 1, null]) expect(normalizePerson('p', { deceased: bad }).deceased).toBe('')
    const l = (extra: Partial<Person>) => lifespan(person('x', extra))
    expect(l({ birthDate: '1890-05', deceased: 'yes' })).toBe('1890–?')
    expect(l({ birthDate: '1890', deathDate: '1950', deceased: 'yes' })).toBe('1890–1950')
    expect(l({ deceased: 'yes' })).toBe('')
    expect(l({ birthDate: '1890' })).toBe('1890')
    expect(l({ deathDate: '1950' })).toBe('?–1950')
  })

  it('validates partial dates', () => {
    for (const ok of ['', '1975', '1975-08', '1975-08-09']) expect(isValidPartialDate(ok)).toBe(true)
    for (const bad of ['61', '1975/08/09', '1975-13', '1975-08-32', 'abcd']) expect(isValidPartialDate(bad)).toBe(false)
  })

  it('groups children by co-parent and sorts by birth', () => {
    const { store } = memoryStore(family())
    const groups = childrenByCoParent(store.people, 'dad')
    expect(groups.get('mom')!.map(p => p.id)).toEqual(['b', 'a'])
    expect(groups.get('mom2')!.map(p => p.id)).toEqual(['c'])
  })

  it('finds half siblings too', () => {
    const { store } = memoryStore(family())
    expect(siblingsOf(store.people, 'c').map(p => p.id).sort()).toEqual(['a', 'b'])
  })

  it('tells half siblings by the one shared parent', () => {
    const { store } = memoryStore(family())
    const get = (id: string) => store.people.get(id)!
    expect(halfSiblingVia(get('a'), get('c'))).toBe('dad')
    expect(halfSiblingVia(get('c'), get('a'))).toBe('dad')
    expect(halfSiblingVia(get('a'), get('b'))).toBeNull()
    const only = person('d', { parents: ['dad'] })
    // The same from both sides, even with one parent recorded.
    expect(halfSiblingVia(only, get('a'))).toBe('dad')
    expect(halfSiblingVia(get('a'), only)).toBe('dad')
    // Two people with the same one parent recorded are full siblings.
    expect(halfSiblingVia(only, person('e', { parents: ['dad'] }))).toBeNull()
    expect(halfSiblingVia(only, person('f', { parents: ['mom'] }))).toBeNull()
  })

  it('orders spouses by marriage date, leaving undated ones in place', () => {
    const people: People = new Map([
      person('p', { spouses: ['w1', 'w2', 'w3', 'w4'], marriages: {
        w1: { married: '1970', divorced: '', status: 'married' }, w3: { married: '1960-05', divorced: '1968', status: 'married' }, w4: { married: '1960', divorced: '', status: 'married' },
      } }),
      ...['w1', 'w2', 'w3', 'w4'].map(id => person(id, { spouses: ['p'] })),
    ].map(p => [p.id, p]))
    expect(partnersOf(people, people.get('p')!).map(s => s.id)).toEqual(['w4', 'w2', 'w3', 'w1'])
  })

  it('drops parent kinds for non-parents and invalid values on load', () => {
    const p = normalizePerson('k', { parents: ['a', 'b'], parentKinds: { a: 'adoptive', b: 'godparent', gone: 'step' } })
    expect(p.parentKinds).toEqual({ a: 'adoptive' })
    expect(normalizePerson('k', { parents: ['a', 'b'], parentKinds: { a: 'foster', b: 'step' } }).parentKinds).toEqual({})
    expect(normalizePerson('k', {}).parentKinds).toEqual({})
    expect(normalizePerson('k', { parents: ['a'], parentKinds: 'step' }).parentKinds).toEqual({})
  })

  it('sets and clears parent kinds, dropping one when the parent is unlinked or deleted', () => {
    const people: People = new Map(family().map(p => [p.id, p]))
    applyOp(people, { type: 'update', id: 'a', parentKinds: { dad: 'adoptive', mom: 'adoptive' } })
    expect(people.get('a')!.parentKinds).toEqual({ dad: 'adoptive', mom: 'adoptive' })
    applyOp(people, { type: 'update', id: 'a', parentKinds: { dad: null } })
    expect(people.get('a')!.parentKinds).toEqual({ mom: 'adoptive' })
    applyOp(people, { type: 'update', id: 'a', remove: { parents: ['mom'] } })
    expect(people.get('a')!.parentKinds).toEqual({})
    applyOp(people, { type: 'update', id: 'b', parentKinds: { mom: 'adoptive' } })
    applyOp(people, { type: 'delete', id: 'mom' })
    applyOp(people, { type: 'update', id: 'b', remove: { parents: ['mom'] } }) // as the store does on delete
    expect(people.get('b')!.parentKinds).toEqual({})
  })

  it('drops empty marriages and marriages to non-spouses on load', () => {
    const p = normalizePerson('p', { spouses: ['s'], marriages: {
      s: { married: '1960' }, gone: { married: '1950', divorced: '' }, t: { married: '', divorced: '' },
    } })
    expect(p.marriages).toEqual({ s: { married: '1960', divorced: '', status: 'married' } })
    expect(normalizePerson('p', {}).marriages).toEqual({})
  })

  it('reads marriage status, treating a missing or invalid one as unknown and dates as implying one', () => {
    const p = normalizePerson('p', { spouses: ['s', 't', 'u', 'v', 'w', 'x', 'y'], marriages: {
      s: { status: 'unmarried' }, t: { status: 'bogus', married: '' }, u: { status: 'unmarried', divorced: '1970' }, v: { status: 'married' },
      w: { status: 'divorced' }, x: { status: 'divorced', married: '1960' }, y: { status: 'married', married: '1960', divorced: '1970' },
    } })
    expect(p.marriages).toEqual({
      s: { married: '', divorced: '', status: 'unmarried' },
      u: { married: '', divorced: '1970', status: 'divorced' },
      v: { married: '', divorced: '', status: 'married' },
      w: { married: '', divorced: '', status: 'divorced' },
      x: { married: '1960', divorced: '', status: 'divorced' },
      // As stored before there was a divorced status.
      y: { married: '1960', divorced: '1970', status: 'divorced' },
    })
  })

  it('counts co-parents as partners, after spouses', () => {
    const { store } = memoryStore([...family(), person('x'), person('k', { parents: ['mom', 'x'] })])
    const ids = (id: string) => partnerIds(store.people, store.people.get(id)!)
    expect(ids('mom')).toEqual(['dad', 'x'])
    expect(ids('x')).toEqual(['mom'])
    expect(ids('dad')).toEqual(['mom', 'mom2'])
  })

  it('searches across Chinese, English and other names', () => {
    const { store } = memoryStore(family())
    expect(searchPeople(store.people, 'alice').map(p => p.id)).toEqual(['a'])
    expect(searchPeople(store.people, 'bee').map(p => p.id)).toEqual(['b'])
    expect(searchPeople(store.people, '小乙').map(p => p.id)).toEqual(['b'])
  })

  it('finds people by pinyin, with or without tones and spaces', () => {
    const people: People = new Map([person('p', { nameZh: '宋文華', pinyin: 'Sòng Wénhuá' }), person('q', { nameZh: '呂' , pinyin: 'Lǚ' })].map(p => [p.id, p]))
    const ids = (q: string) => searchPeople(people, q).map(p => p.id)
    for (const q of ['wenhua', 'Wen Hua', 'wénhuá', 'wen2hua2', 'songwen']) expect(ids(q), q).toEqual(['p'])
    expect(ids('lv')).toEqual(['q'])
    expect(ids('wenhuang')).toEqual([])
    // Digits and punctuation alone fold to nothing, which must not match everyone.
    expect(ids('2')).toEqual([])
  })

  it('root ancestors skip in-laws', () => {
    const people = family()
    people.push(person('inlaw', { spouses: ['a'] }), person('gc', { parents: ['a', 'inlaw'] }))
    people.find(p => p.id === 'a')!.spouses.push('inlaw')
    const { store } = memoryStore(people)
    expect(rootAncestors(store.people).map(p => p.id)).toEqual(['dad'])
  })

  it('senior ancestor heads the most generations, then the most descendants, then is born first', () => {
    // A deeper line beats a bigger, earlier-entered one.
    const deep = [
      person('x', { order: 0 }), person('x1', { parents: ['x'] }), person('x2', { parents: ['x'] }), person('x3', { parents: ['x'] }),
      person('g', { order: 1 }), person('g1', { parents: ['g'] }), person('g2', { parents: ['g1'] }),
    ]
    expect(seniorAncestor(new Map(deep.map(p => [p.id, p])))?.id).toBe('g')

    // Equal depth: more descendants wins.
    const wide = [
      person('x', { order: 0 }), person('x1', { parents: ['x'] }),
      person('y', { order: 1 }), person('y1', { parents: ['y'] }), person('y2', { parents: ['y'] }),
    ]
    expect(seniorAncestor(new Map(wide.map(p => [p.id, p])))?.id).toBe('y')

    // Same shape: earlier birth wins, then earlier entry.
    const twins = [
      person('x', { order: 0, birthDate: '1920' }), person('x1', { parents: ['x'] }),
      person('y', { order: 1, birthDate: '1910' }), person('y1', { parents: ['y'] }),
    ]
    expect(seniorAncestor(new Map(twins.map(p => [p.id, p])))?.id).toBe('y')
    twins[2].birthDate = ''
    expect(seniorAncestor(new Map(twins.map(p => [p.id, p])))?.id).toBe('x')
  })

  it('ranks everyone: deeper lines first, parents before children, then the childless by birth', () => {
    const rank = (list: Person[]) => rankPeople(new Map(list.map(p => [p.id, p]))).map(p => p.id)
    const deep = [
      person('x', { order: 0 }), person('x1', { parents: ['x'], order: 1 }), person('x2', { parents: ['x'], order: 2 }), person('x3', { parents: ['x'], order: 3 }),
      person('g', { order: 4 }), person('g1', { parents: ['g'], order: 5 }), person('g2', { parents: ['g1'], order: 6, birthDate: '1990' }),
    ]
    // A deeper line beats a wider one; the childless come last by birth, then entry order.
    expect(rank(deep)).toEqual(['g', 'x', 'g1', 'x1', 'x2', 'x3', 'g2'])
    const born = [
      person('a', { order: 0, birthDate: '1950' }), person('b', { order: 1, birthDate: '1940' }), person('c', { order: 2 }),
    ]
    expect(rank(born)).toEqual(['b', 'a', 'c'])

    // The top entry is the senior ancestor in each of the cases above.
    const wide = [
      person('x', { order: 0 }), person('x1', { parents: ['x'] }),
      person('y', { order: 1 }), person('y1', { parents: ['y'] }), person('y2', { parents: ['y'] }),
    ]
    const twins = [
      person('x', { order: 0, birthDate: '1920' }), person('x1', { parents: ['x'] }),
      person('y', { order: 1, birthDate: '1910' }), person('y1', { parents: ['y'] }),
    ]
    for (const list of [deep, wide, twins, family()]) {
      expect(rank(list)[0]).toBe(seniorAncestor(new Map(list.map(p => [p.id, p])))?.id)
    }
  })

  it('ranks a parent before their children even when a spouse married in', () => {
    const people = family()
    people.push(person('inlaw', { spouses: ['a'], order: 10 }), person('gc', { parents: ['a', 'inlaw'], order: 11 }))
    const ids = rankPeople(new Map(people.map(p => [p.id, p]))).map(p => p.id)
    for (const p of people) for (const parent of p.parents) expect(ids.indexOf(parent)).toBeLessThan(ids.indexOf(p.id))
  })
})

describe('store', () => {
  it('adds a spouse on both sides and logs it', async () => {
    const { store, changes } = memoryStore(family())
    const id = await store.addRelative('Tester', 'spouse', 'a', { ...emptyFields(), nameZh: '配' })
    expect(store.people.get(id)!.spouses).toEqual(['a'])
    expect(store.people.get('a')!.spouses).toEqual([id])
    expect(changes[0].editor).toBe('Tester')
    expect(changes[0].diffs.map(d => d.id).sort()).toEqual(['a', id].sort())
  })

  it('adds a child with a chosen co-parent, who becomes a spouse', async () => {
    const { store } = memoryStore(family())
    const id = await store.addRelative('K', 'child', 'dad', emptyFields(), { coParentId: 'mom2' })
    expect(store.people.get(id)!.parents).toEqual(['dad', 'mom2'])
    const kid = await store.addRelative('K', 'child', 'mom', emptyFields(), { coParentId: 'mom2' })
    expect(store.people.get(kid)!.parents).toEqual(['mom', 'mom2'])
    expect(store.people.get('mom')!.spouses).toEqual(['dad', 'mom2'])
    expect(store.people.get('mom2')!.spouses).toEqual(['dad', 'mom'])
    await expect(store.addRelative('K', 'child', 'dad', emptyFields(), { coParentId: 'nobody' })).rejects.toThrow()
  })

  it('adds a parent as spouse of the existing parent', async () => {
    const people = [person('kid', { parents: ['p1'] }), person('p1')]
    const { store } = memoryStore(people)
    const id = await store.addRelative('K', 'parent', 'kid', emptyFields())
    expect(store.people.get('kid')!.parents).toEqual(['p1', id])
    expect(store.people.get('p1')!.spouses).toEqual([id])
    expect(store.people.get(id)!.spouses).toEqual(['p1'])
    await expect(store.addRelative('K', 'parent', 'kid', emptyFields())).rejects.toThrow()
  })

  it('adds a spouse, optionally as the other parent of single-parent children', async () => {
    const people = [person('p1'), person('k1', { parents: ['p1'] }), person('k2', { parents: ['p1'] }), person('x'), person('k3', { parents: ['p1', 'x'] })]
    const { store } = memoryStore(people)
    const id = await store.addRelative('K', 'spouse', 'p1', emptyFields(), { alsoParentOf: ['k1', 'k2'] })
    expect(store.people.get('k1')!.parents).toEqual(['p1', id])
    expect(store.people.get('k2')!.parents).toEqual(['p1', id])
    expect(store.people.get(id)!.spouses).toEqual(['p1'])
    await expect(store.addRelative('K', 'spouse', 'p1', emptyFields(), { alsoParentOf: ['k3'] })).rejects.toThrow()
    await expect(store.addRelative('K', 'spouse', 'x', emptyFields(), { alsoParentOf: ['k1'] })).rejects.toThrow()
  })

  it('adds a sibling with the same parents, and refuses without parents', async () => {
    const { store } = memoryStore(family())
    const id = await store.addRelative('K', 'sibling', 'c', emptyFields())
    expect(store.people.get(id)!.parents).toEqual(['dad', 'mom2'])
    await expect(store.addRelative('K', 'sibling', 'dad', emptyFields())).rejects.toThrow()
  })

  it('adds a half sibling with chosen parents, which must include a shared one', async () => {
    const { store } = memoryStore(family())
    const half = await store.addRelative('K', 'sibling', 'a', emptyFields(), { parentIds: ['dad', 'mom2'] })
    expect(store.people.get(half)!.parents).toEqual(['dad', 'mom2'])
    // Two parents become a couple.
    const other = await store.addRelative('K', 'sibling', 'c', emptyFields(), { parentIds: ['mom2', 'mom'] })
    expect(store.people.get(other)!.parents).toEqual(['mom2', 'mom'])
    expect(store.people.get('mom')!.spouses).toContain('mom2')
    expect(store.people.get('mom2')!.spouses).toContain('mom')
    const only = await store.addRelative('K', 'sibling', 'a', emptyFields(), { parentIds: ['dad'] })
    expect(store.people.get(only)!.parents).toEqual(['dad'])
    await expect(store.addRelative('K', 'sibling', 'a', emptyFields(), { parentIds: ['mom2'] })).rejects.toThrow()
    await expect(store.addRelative('K', 'sibling', 'a', emptyFields(), { parentIds: [] })).rejects.toThrow()
    await expect(store.addRelative('K', 'sibling', 'a', emptyFields(), { parentIds: ['dad', 'dad'] })).rejects.toThrow()
    await expect(store.addRelative('K', 'sibling', 'a', emptyFields(), { parentIds: ['dad', 'nobody'] })).rejects.toThrow()
  })

  it('only writes changed fields', async () => {
    const { store, changes } = memoryStore(family())
    const a = store.people.get('a')!
    await store.updateFields('K', 'a', { ...a, nameZh: a.nameZh })
    expect(changes).toHaveLength(0)
    await store.updateFields('K', 'a', { ...a, birthDate: '1990-01-02' })
    expect(store.people.get('a')!.birthDate).toBe('1990-01-02')
  })

  it('rejects invalid links', () => {
    const { store } = memoryStore(family())
    expect(store.linkProblem('spouse', 'a', 'a')).toBeTruthy()
    expect(store.linkProblem('spouse', 'dad', 'mom')).toBeTruthy()
    expect(store.linkProblem('parent', 'a', 'mom2')).toBeTruthy() // already two parents
    expect(store.linkProblem('parent', 'dad', 'a')).toBeTruthy() // loop
    expect(store.linkProblem('spouse', 'a', 'c')).toBeNull()
  })

  it('links the existing parent and a newly linked one as spouses', async () => {
    const { store } = memoryStore([person('kid', { parents: ['p1'] }), person('p1'), person('p2'), person('kid2'), person('p3')])
    await store.link('K', 'parent', 'kid', 'p2')
    expect(store.people.get('p1')!.spouses).toEqual(['p2'])
    expect(store.people.get('p2')!.spouses).toEqual(['p1'])
    await store.link('K', 'child', 'p3', 'kid2')
    expect(store.people.get('p3')!.spouses).toEqual([])
    await store.link('K', 'child', 'p1', 'kid2')
    expect(store.people.get('p1')!.spouses).toEqual(['p2', 'p3'])
  })

  it('links a spouse as the other parent of single-parent children', async () => {
    const people = [person('p1'), person('k1', { parents: ['p1'] }), person('x'), person('k2', { parents: ['p1', 'x'] }), person('s')]
    const { store } = memoryStore(people)
    await expect(store.link('K', 'spouse', 'p1', 's', { alsoParentOf: ['k2'] })).rejects.toThrow()
    // A child can't become their own parent.
    await expect(store.link('K', 'spouse', 'p1', 'k1', { alsoParentOf: ['k1'] })).rejects.toThrow()
    await store.link('K', 'spouse', 'p1', 's', { alsoParentOf: ['k1'] })
    expect(store.people.get('k1')!.parents).toEqual(['p1', 's'])
    expect(store.people.get('s')!.spouses).toEqual(['p1'])
    expect(store.people.get('p1')!.spouses).toEqual(['s'])
  })

  it('refuses to unlink spouses who share a child', async () => {
    const { store } = memoryStore(family())
    expect(store.unlinkProblem('spouse', 'dad', 'mom')).toBeTruthy()
    expect(store.unlinkProblem('parent', 'a', 'dad')).toBeNull()
    await expect(store.unlink('K', 'spouse', 'dad', 'mom')).rejects.toThrow()
    expect(store.people.get('dad')!.spouses).toContain('mom')
  })

  it('sets the marriage of co-parents who are not spouses, linking them', async () => {
    const { store, changes } = memoryStore([...family(), person('x'), person('k', { parents: ['mom', 'x'] })])
    await store.setMarriage('K', 'x', 'mom', { married: '', divorced: '', status: 'unmarried' })
    expect(changes).toHaveLength(1)
    expect(store.people.get('x')!.spouses).toEqual(['mom'])
    expect(store.people.get('mom')!.spouses).toEqual(['dad', 'x'])
    expect(store.people.get('x')!.marriages).toEqual({ mom: { married: '', divorced: '', status: 'unmarried' } })
    expect(store.people.get('mom')!.marriages).toEqual({ x: { married: '', divorced: '', status: 'unmarried' } })
    // Any date means married.
    await store.setMarriage('K', 'x', 'mom', { married: '1990', divorced: '', status: 'unmarried' })
    expect(store.people.get('mom')!.marriages.x.status).toBe('married')
    // A divorce date means divorced; divorced with only a marriage date stays divorced.
    await store.setMarriage('K', 'x', 'mom', { married: '1990', divorced: '2000', status: 'married' })
    expect(store.people.get('x')!.marriages.mom.status).toBe('divorced')
    await store.setMarriage('K', 'x', 'mom', { married: '1990', divorced: '', status: 'divorced' })
    expect(store.people.get('mom')!.marriages.x).toEqual({ married: '1990', divorced: '', status: 'divorced' })
  })

  it('links and unlinks spouses symmetrically', async () => {
    const { store } = memoryStore(family())
    await store.link('K', 'spouse', 'mom', 'mom2')
    expect(store.people.get('mom2')!.spouses).toContain('mom')
    await store.unlink('K', 'spouse', 'mom2', 'mom')
    expect(store.people.get('mom')!.spouses).toEqual(['dad'])
  })

  it('sets a parent kind, skips no-ops, and reverts', async () => {
    const { store, changes } = memoryStore(family())
    await store.setParentKind('K', 'a', 'dad', 'adoptive')
    expect(store.people.get('a')!.parentKinds).toEqual({ dad: 'adoptive' })
    expect(changes.at(-1)!.summary).toContain('爸 → 甲')
    await store.setParentKind('K', 'a', 'dad', 'adoptive')
    expect(changes.length).toBe(1)
    await expect(store.setParentKind('K', 'a', 'mom2', 'adoptive')).rejects.toThrow()
    await store.setParentKind('K', 'a', 'dad', '')
    expect(store.people.get('a')!.parentKinds).toEqual({})
    await store.revert('K', changes.at(-1)!)
    expect(store.people.get('a')!.parentKinds).toEqual({ dad: 'adoptive' })
  })

  it('sets marriage dates on both spouses, clears them, and drops them on unlink', async () => {
    const { store, changes } = memoryStore(family())
    const m = { married: '1980-06', divorced: '1988', status: 'divorced' as const }
    await store.setMarriage('K', 'mom', 'dad', m)
    expect(store.people.get('dad')!.marriages).toEqual({ mom: m })
    expect(store.people.get('mom')!.marriages).toEqual({ dad: m })
    expect(changes.at(-1)!.summary).toContain('媽 & 爸')
    await store.setMarriage('K', 'mom', 'dad', m)
    expect(changes.length).toBe(1) // unchanged: no commit
    await expect(store.setMarriage('K', 'mom', 'mom2', m)).rejects.toThrow()

    await store.setMarriage('K', 'dad', 'mom2', { married: '1990', divorced: '', status: '' })
    await store.setMarriage('K', 'dad', 'mom2', { married: '', divorced: '', status: '' })
    expect(store.people.get('dad')!.marriages).toEqual({ mom: m })
    expect(store.people.get('mom2')!.marriages).toEqual({})

    // Spouses without children together can be unlinked, which drops their marriage.
    await store.link('K', 'spouse', 'b', 'c')
    await store.setMarriage('K', 'b', 'c', m)
    await store.unlink('K', 'spouse', 'b', 'c')
    expect(store.people.get('b')!.marriages).toEqual({})
    expect(store.people.get('c')!.marriages).toEqual({})
    await store.revert('K', changes.at(-1)!)
    expect(store.people.get('c')!.marriages).toEqual({ b: m })
  })

  it('delete strips references, and revert restores everything', async () => {
    const { store, changes } = memoryStore(family())
    const before = structuredClone([...store.people.values()])
    await store.deletePerson('K', 'dad')
    expect(store.people.has('dad')).toBe(false)
    expect(store.people.get('a')!.parents).toEqual(['mom'])
    expect(store.people.get('mom')!.spouses).toEqual([])
    await store.revert('K', changes[0])
    expect([...store.people.values()].sort((x, y) => x.id.localeCompare(y.id)))
      .toEqual(before.sort((x, y) => x.id.localeCompare(y.id)))
  })

  it('reverting an add removes the new person', async () => {
    const { store, changes } = memoryStore(family())
    const id = await store.addRelative('K', 'spouse', 'c', emptyFields())
    await store.revert('K', changes[0])
    expect(store.people.has(id)).toBe(false)
    expect(store.people.get('c')!.spouses).toEqual([])
  })
})

describe('seed format', () => {
  it('maps keys to ids and makes spouses symmetric', () => {
    let n = 0
    const people = seedToPeople([
      { key: 'x', spouses: ['y'] }, { key: 'y' }, { key: 'z', parents: ['x', 'y'] },
    ], () => `id${n++}`)
    expect(people.map(p => [p.id, p.spouses, p.parents, p.order])).toEqual([
      ['id0', ['id1'], [], 0], ['id1', ['id0'], [], 1], ['id2', [], ['id0', 'id1'], 2],
    ])
    expect(() => seedToPeople([{ key: 'a', parents: ['nope'] }], () => 'q')).toThrow()
  })

  it("makes a child's two parents spouses", () => {
    let n = 0
    const people = seedToPeople([{ key: 'x' }, { key: 'y' }, { key: 'z', parents: ['x', 'y'] }], () => `id${n++}`)
    expect(people.map(p => p.spouses)).toEqual([['id1'], ['id0'], []])
  })
})

describe('contact fields', () => {
  it('fills in missing contact fields on old data', () => {
    const p = normalizePerson('x', { nameZh: '甲', parents: [] })
    expect([p.email, p.phone, p.address, p.line, p.signal]).toEqual(['', '', '', '', ''])
  })

  it('validates emails loosely', () => {
    for (const ok of ['', 'a@b.co', 'first.last+tag@mail.example.org']) expect(isValidEmail(ok), ok).toBe(true)
    for (const bad of ['a', 'a@b', '@b.co', 'a b@c.de', 'a@b.co ']) expect(isValidEmail(bad), bad).toBe(false)
  })

  it('normalizes phones to E.164 and formats them for display', () => {
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone('+1 (201) 555-0123')).toBe('+12015550123')
    expect(normalizePhone('+886 912-345-678')).toBe('+886912345678')
    expect(normalizePhone('＋８８６ ９１２ ３４５ ６７８')).toBe('+886912345678') // full-width
    for (const bad of ['201-555-0123', '0912345678', '+1 555 010 0000', 'call me', '+886 912 345 678 #12', '+1 201 555 0123 ext. 4']) expect(normalizePhone(bad), bad).toBeNull()
    expect(isValidPhone('+886912345678')).toBe(true)
    expect(isValidPhone('+886 912 345 678')).toBe(false)
    expect(formatPhone('+886912345678')).toBe('+886 912 345 678')
    expect(formatPhone('+12015550123')).toBe('+1 201 555 0123')
  })

  it('orders siblings by date only where dates decide, else by hand', () => {
    const p = (birthDate: string, order: number) => ({ birthDate, order })
    expect(datesDecide(p('1950', 1), p('1960', 0))).toBe(true)
    expect(datesDecide(p('1950', 1), p('1950-05', 0))).toBe(false) // a prefix: no
    expect(datesDecide(p('1950-05', 1), p('1950', 0))).toBe(false)
    expect(datesDecide(p('1950-05', 1), p('1950-06', 0))).toBe(true)
    expect(datesDecide(p('1950-05-01', 1), p('1950-05-01', 0))).toBe(false) // twins
    expect(datesDecide(p('', 1), p('1950', 0))).toBe(false)
    expect(byBirth(p('1960', 0), p('1950', 1))).toBeGreaterThan(0)
    expect(byBirth(p('1950', 1), p('1950-05', 0))).toBeGreaterThan(0) // entry order
    expect(byBirth(p('1950-05-01', 1), p('1950-05-01', 2))).toBeLessThan(0)
    expect(byBirth(p('', 5), p('1950', 3))).toBeGreaterThan(0)
  })

  it('hands a sibling group its own order values in a new sequence', () => {
    const o = (id: string, order: number) => ({ id, order })
    expect([...reorderValues([o('c', 3), o('a', 1), o('b', 2)])]).toEqual([['c', 1], ['a', 2], ['b', 3]])
    expect(reorderValues([o('a', 1), o('b', 2), o('c', 3)]).size).toBe(0)
    // Equal values are bumped so the order stays strict.
    expect([...reorderValues([o('b', 5), o('a', 5), o('c', 5)])]).toEqual([['a', 6], ['c', 7]])
    expect([...reorderValues([o('b', 5), o('a', 5)])]).toEqual([['a', 6]])
  })

  it('reorders siblings through the store, refusing what dates contradict', async () => {
    const { store, people, changes } = memoryStore([
      person('p', { gender: 'M' }),
      person('x', { parents: ['p'], order: 1 }), person('y', { parents: ['p'], order: 2 }), person('z', { parents: ['p'], order: 3 }),
      person('e', { parents: ['p'], order: 4, birthDate: '1950' }), person('f', { parents: ['p'], order: 5, birthDate: '1960' }),
    ])
    await store.reorder('Ed', ['z', 'x', 'y'])
    expect(['z', 'x', 'y'].map(id => people.get(id)!.order)).toEqual([1, 2, 3])
    expect(changes.at(-1)!.summary).toContain('Changed birth order')
    await store.reorder('Ed', ['z', 'x', 'y']) // nothing changes: nothing logged
    expect(changes.length).toBe(1)
    await expect(store.reorder('Ed', ['f', 'e'])).rejects.toThrow()
    await expect(store.reorder('Ed', ['x', 'x'])).rejects.toThrow()
    expect(changes.length).toBe(1)
  })
})
