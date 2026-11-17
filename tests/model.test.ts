import { describe, expect, it } from 'vitest'
import { type People, type Person, childrenByCoParent, emptyFields, formatPhone, isValidEmail, isValidPartialDate, isValidPhone, normalizePerson, normalizePhone, rootAncestors, searchPeople, seniorAncestor, siblingsOf } from '../src/model'
import { applyOp, FamilyStore, simulate, type Backend, type ChangeRecord, type NewChange, type Op } from '../src/store'
import { seedToPeople } from '../src/seed-format'

/** In-memory backend mirroring what the Worker does: compute diffs, apply ops, log. */
function memoryStore(seed: Person[]) {
  let n = 0
  const people: People = new Map(seed.map(p => [p.id, p]))
  const changes: ChangeRecord[] = []
  let store: FamilyStore
  const backend: Backend = {
    newId: () => `new${++n}`,
    subscribePeople: () => () => {},
    subscribeChanges: () => () => {},
    async commit(ops: Op[], change: NewChange) {
      const diffs = simulate(people, ops)
      for (const op of ops) applyOp(people, op)
      changes.push({ ...change, diffs, id: String(changes.length + 1), at: Date.now() })
      store.setPeople([...people.values()])
    },
  }
  store = new FamilyStore(backend)
  store.setPeople(seed)
  return { store, people, changes }
}

const person = (id: string, extra: Partial<Person> = {}): Person =>
  ({ ...emptyFields(), id, parents: [], spouses: [], order: 0, ...extra })

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

  it('searches across Chinese, English and other names', () => {
    const { store } = memoryStore(family())
    expect(searchPeople(store.people, 'alice').map(p => p.id)).toEqual(['a'])
    expect(searchPeople(store.people, 'bee').map(p => p.id)).toEqual(['b'])
    expect(searchPeople(store.people, '小乙').map(p => p.id)).toEqual(['b'])
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

  it('adds a child with a chosen co-parent', async () => {
    const { store } = memoryStore(family())
    const id = await store.addRelative('K', 'child', 'dad', emptyFields(), { coParentId: 'mom2' })
    expect(store.people.get(id)!.parents).toEqual(['dad', 'mom2'])
  })

  it('adds a parent, optionally as spouse of the existing parent', async () => {
    const people = [person('kid', { parents: ['p1'] }), person('p1')]
    const { store } = memoryStore(people)
    const id = await store.addRelative('K', 'parent', 'kid', emptyFields(), { alsoSpouseOf: 'p1' })
    expect(store.people.get('kid')!.parents).toEqual(['p1', id])
    expect(store.people.get('p1')!.spouses).toEqual([id])
    await expect(store.addRelative('K', 'parent', 'kid', emptyFields())).rejects.toThrow()
  })

  it('adds a sibling with the same parents, and refuses without parents', async () => {
    const { store } = memoryStore(family())
    const id = await store.addRelative('K', 'sibling', 'c', emptyFields())
    expect(store.people.get(id)!.parents).toEqual(['dad', 'mom2'])
    await expect(store.addRelative('K', 'sibling', 'dad', emptyFields())).rejects.toThrow()
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

  it('links and unlinks spouses symmetrically', async () => {
    const { store } = memoryStore(family())
    await store.link('K', 'spouse', 'mom', 'mom2')
    expect(store.people.get('mom2')!.spouses).toContain('mom')
    await store.unlink('K', 'spouse', 'mom2', 'mom')
    expect(store.people.get('mom')!.spouses).toEqual(['dad'])
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
})
