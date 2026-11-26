// @vitest-environment jsdom
// jsdom because computeStats lives beside the page code, which imports i18n (it reads localStorage).
import { describe, expect, it } from 'vitest'
import { type People, type Person, emptyFields } from '../src/model'
import { computeStats } from '../src/stats'

const person = (id: string, extra: Partial<Person> = {}): Person =>
  ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, parentKinds: {}, order: 0, ...extra })
const peopleOf = (list: Person[]): People => new Map(list.map((p, i) => [p.id, { ...p, order: i }]))
const ids = (list: Person[]) => list.map(p => p.id).sort()

describe('computeStats generations', () => {
  it('gives an in-law their spouse\'s generation', () => {
    const s = computeStats(peopleOf([
      person('gp', { spouses: ['gm'] }), person('gm', { spouses: ['gp'] }),
      person('kid', { parents: ['gp', 'gm'], spouses: ['inlaw'] }), person('inlaw', { spouses: ['kid'] }),
      person('grandkid', { parents: ['kid', 'inlaw'] }),
    ]))
    expect(s.generations.map(ids)).toEqual([['gm', 'gp'], ['inlaw', 'kid'], ['grandkid']])
    expect(s.unlinked).toEqual([])
  })

  it('starts each unconnected family at generation 1', () => {
    const s = computeStats(peopleOf([
      person('a'), person('b', { parents: ['a'] }), person('c', { parents: ['b'] }),
      person('x'), person('y', { parents: ['x'] }),
    ]))
    expect(s.generations.map(ids)).toEqual([['a', 'x'], ['b', 'y'], ['c']])
  })

  it('counts someone with no relationships as unlinked, outside the generations', () => {
    const s = computeStats(peopleOf([person('a'), person('b', { parents: ['a'] }), person('solo')]))
    expect(ids(s.unlinked)).toEqual(['solo'])
    expect(s.generations.flat().length).toBe(2)
    expect(s.total).toBe(3)
  })

  it('terminates on a cousin marriage and keeps everyone in one generation each', () => {
    const s = computeStats(peopleOf([
      person('root'),
      person('p1', { parents: ['root'] }), person('p2', { parents: ['root'] }),
      person('c1', { parents: ['p1'], spouses: ['c2'] }), person('c2', { parents: ['p2'], spouses: ['c1'] }),
      person('kid', { parents: ['c1', 'c2'] }),
    ]))
    expect(s.generations.map(ids)).toEqual([['root'], ['p1', 'p2'], ['c1', 'c2'], ['kid']])
  })

  it('shifts a family whose BFS starts mid-tree so its top is generation 1', () => {
    // 'in' marries into the family and has a parent of their own, who is above the family's top couple's level.
    const s = computeStats(peopleOf([
      person('top'), person('mid', { parents: ['top'], spouses: ['in'] }),
      person('in', { spouses: ['mid'], parents: ['inparent'] }), person('inparent'),
    ]))
    expect(s.generations.map(ids)).toEqual([['inparent', 'top'], ['in', 'mid']])
  })
})

describe('computeStats living', () => {
  it('counts everyone not marked deceased as living, however old', () => {
    const s = computeStats(peopleOf([
      person('alive', { birthDate: '1990' }),
      person('nodates'),
      person('dead', { deceased: 'yes', birthDate: '1990' }),
      person('died', { deathDate: '2000' }),
      person('old', { birthDate: '1850' }), // no death recorded, so not presumed dead
    ]))
    expect(ids(s.living)).toEqual(['alive', 'nodates', 'old'])
  })

  it('splits by gender, with unknown for the unrecorded', () => {
    const s = computeStats(peopleOf([person('m', { gender: 'M' }), person('f', { gender: 'F' }), person('u')]))
    expect([s.gender.M.length, s.gender.F.length, s.gender.U.length]).toEqual([1, 1, 1])
  })
})

describe('computeStats birth years', () => {
  it('buckets by decade including empty ones, and finds the range', () => {
    const s = computeStats(peopleOf([
      person('a', { birthDate: '1887-05-01' }), person('b', { birthDate: '1889' }),
      person('c', { birthDate: '1915' }), person('none'), person('bad', { birthDate: '19' }),
    ]))
    expect(s.decades.map(d => [d.decade, d.people.length])).toEqual([[1880, 2], [1890, 0], [1900, 0], [1910, 1]])
    expect(ids(s.noBirthYear)).toEqual(['bad', 'none'])
    expect(s.firstYear).toBe(1887)
    expect(s.lastYear).toBe(1915)
  })

  it('has no range without birth years', () => {
    const s = computeStats(peopleOf([person('a')]))
    expect(s.decades).toEqual([])
    expect([s.firstYear, s.lastYear]).toEqual([null, null])
  })
})

describe('computeStats records', () => {
  const today = new Date(2026, 10, 19)
  const rec = (list: Person[], id: string) => computeStats(peopleOf(list), today).records.find(r => r.id === id)

  it('ties a couple on most descendants and most children', () => {
    const list = [
      person('gp', { spouses: ['gm'] }), person('gm', { spouses: ['gp'] }),
      person('k1', { parents: ['gp', 'gm'] }), person('k2', { parents: ['gp', 'gm'] }), person('g', { parents: ['k1'] }),
    ]
    expect(ids(rec(list, 'mostDescendants')!.people)).toEqual(['gm', 'gp'])
    expect(rec(list, 'mostDescendants')!.n).toBe(3)
    expect(ids(rec(list, 'mostChildren')!.people)).toEqual(['gm', 'gp'])
    expect(rec(list, 'mostChildren')!.n).toBe(2)
  })

  it('omits records nobody qualifies for', () => {
    const s = computeStats(peopleOf([person('a'), person('b')]), today)
    expect(s.records).toEqual([])
  })

  it('has no age cap on oldest living and skips the deceased', () => {
    const list = [
      person('old', { birthDate: '1890-01-01' }), person('dead', { birthDate: '1850', deceased: 'yes' }),
      person('mid', { birthDate: '1980-05-05' }), person('kid', { birthDate: '2020-02-02' }),
      person('gone', { birthDate: '2024-01-01', deathDate: '2025-01-01' }),
    ]
    expect(rec(list, 'oldestLiving')).toMatchObject({ n: 136, approx: false })
    expect(ids(rec(list, 'oldestLiving')!.people)).toEqual(['old'])
    expect(ids(rec(list, 'youngest')!.people)).toEqual(['kid'])
  })

  it('ties same-age people whose birth order is not decided', () => {
    const list = [person('a', { birthDate: '1990' }), person('b', { birthDate: '1990-06' }), person('c', { birthDate: '1990-06-12' })]
    expect(ids(rec(list, 'oldestLiving')!.people)).toEqual(['a', 'b', 'c'])
  })

  it('finds the oldest even with undated people entered between', () => {
    const list = [person('young', { birthDate: '1990' }), person('undated'), person('elder', { birthDate: '1950' })]
    expect(ids(rec(list, 'oldestLiving')!.people)).toEqual(['elder'])
    expect(ids(rec(list, 'youngest')!.people)).toEqual(['young'])
  })

  it('gives a baby youngest an age in months, or days under a month', () => {
    const youngest = (birthDate: string) => rec([person('old', { birthDate: '1950' }), person('kid', { birthDate })], 'youngest')
    expect(youngest('2026-03-05')).toMatchObject({ n: 0, months: 8, approx: false })
    expect(youngest('2026-03')).toMatchObject({ n: 0, months: 8, approx: true })
    expect(youngest('2026-11-10')).toMatchObject({ months: 0, days: 9, approx: false })
    expect(youngest('2026-10-25')).toMatchObject({ months: 0, days: 25 })
    expect(youngest('2026-11')).toMatchObject({ months: 0, approx: true })
    expect(youngest('2026-11')!.days).toBeUndefined()
    expect(youngest('2026')!.months).toBeUndefined()
    expect(youngest('2024-03-05')!.months).toBeUndefined()
  })

  it('leaves out youngest when only one living person has an age', () => {
    expect(rec([person('a', { birthDate: '1990' }), person('b')], 'youngest')).toBeUndefined()
  })

  it('ranks longest lived by the death date', () => {
    const list = [
      person('a', { birthDate: '1900-01-01', deathDate: '1990-01-01' }), person('b', { birthDate: '1900-01-01', deathDate: '1980-01-01' }),
      person('c', { birthDate: '1900-01-01', deceased: 'yes' }), person('d', { birthDate: '1800-01-01' }),
    ]
    expect(rec(list, 'longestLived')).toMatchObject({ n: 90, approx: false })
    expect(ids(rec(list, 'longestLived')!.people)).toEqual(['a'])
  })

  describe('longest marriage', () => {
    const couple = (m: Partial<Person['marriages'][string]>, a: Partial<Person> = {}, b: Partial<Person> = {}) => [
      person('a', { spouses: ['b'], marriages: { b: { married: '', divorced: '', status: 'married', ...m } }, ...a }),
      person('b', { spouses: ['a'], ...b }),
    ]
    it('runs to today by default', () => {
      const r = rec(couple({ married: '2000-01-01' }), 'longestMarriage')!
      expect(r).toMatchObject({ n: 26, approx: false })
      expect(ids(r.people)).toEqual(['a', 'b'])
    })
    it('ends at a divorce date', () => {
      expect(rec(couple({ married: '2000', divorced: '2010', status: 'divorced' }), 'longestMarriage')).toMatchObject({ n: 10, approx: true })
    })
    it('ends at a death, whichever is first', () => {
      expect(rec(couple({ married: '2000-01-01' }, {}, { deathDate: '2005-01-01' }), 'longestMarriage')!.n).toBe(5)
      expect(rec(couple({ married: '2000-01-01', divorced: '2003-01-01' }, {}, { deathDate: '2005-01-01' }), 'longestMarriage')!.n).toBe(3)
    })
    it('skips couples whose end is unknown', () => {
      expect(rec(couple({ married: '2000-01-01', status: 'divorced' }), 'longestMarriage')).toBeUndefined()
      expect(rec(couple({ married: '2000-01-01' }, {}, { deceased: 'yes' }), 'longestMarriage')).toBeUndefined()
      expect(rec(couple({ status: 'married' }), 'longestMarriage')).toBeUndefined()
      expect(rec(couple({ married: '2000-01-01' }, {}, { deathDate: '1990-01-01' }), 'longestMarriage')).toBeUndefined()
    })
  })
})
