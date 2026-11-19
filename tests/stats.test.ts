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
