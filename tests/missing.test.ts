// @vitest-environment jsdom
// jsdom because findGaps lives beside the page code, which imports i18n (it reads localStorage).
import { describe, expect, it } from 'vitest'
import { type People, type Person, emptyFields } from '../src/model'
import { kinDistance } from '../src/kinship'
import { type Gap, findGaps } from '../src/missing'

const person = (id: string, extra: Partial<Person> = {}): Person =>
  ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, parentKinds: {}, order: 0, ...extra })
const peopleOf = (list: Person[]): People => new Map(list.map((p, i) => [p.id, { ...p, order: i }]))
/** A person with everything the ranking looks for filled in, so only `extra` can be missing. */
const full = (id: string, extra: Partial<Person> = {}) =>
  person(id, { nameZh: id, gender: 'M', birthDate: '1980', ...extra })
const find = (gaps: Gap[], kind: string, id: string) => gaps.find(g => g.kind === kind && g.person.id === id)
const kinds = (gaps: Gap[], id: string) => gaps.filter(g => g.person.id === id).map(g => g.kind)

/** me, his father, grandfather and an uncle's son (cousin), with parents recorded for all. */
function family() {
  return [
    full('gp', { parents: ['ggp'] }), full('ggp', { parents: ['gggp'] }), full('gggp', { parents: ['g4'] }), full('g4'),
    full('uncle', { parents: ['gp'] }), full('cousin', { parents: ['uncle'] }),
    full('dad', { parents: ['gp'] }), full('me', { parents: ['dad'] }),
  ]
}

describe('findGaps ranking', () => {
  it('ranks self before parent before cousin for the same kind of gap', () => {
    const people = peopleOf(family().map(p => ({ ...p, birthDate: '' })))
    const order = findGaps(people, 'me').filter(g => g.kind === 'birthDate').map(g => g.person.id)
    expect(order.indexOf('me')).toBeLessThan(order.indexOf('dad'))
    expect(order.indexOf('dad')).toBeLessThan(order.indexOf('cousin'))
  })

  it('gives no gap for a year-only birth date, and one for none', () => {
    const gaps = findGaps(peopleOf([full('a', { birthDate: '1950' }), full('b', { birthDate: '' })]), 'a')
    expect(find(gaps, 'birthDate', 'a')).toBeUndefined()
    expect(find(gaps, 'birthDate', 'b')).toBeDefined()
  })

  it('asks for the death date of someone deceased with none', () => {
    const gaps = findGaps(peopleOf([full('a', { deceased: 'yes' }), full('b', { deceased: 'yes', deathDate: '1990' })]), 'a')
    expect(find(gaps, 'deathDate', 'a')).toBeDefined()
    expect(find(gaps, 'deathDate', 'b')).toBeUndefined()
  })

  it('scores birth, death and marriage gaps equally, above parents', () => {
    const people = peopleOf([
      full('me', { birthDate: '', deceased: 'yes', spouses: ['w'] }), full('w', { gender: 'F', spouses: ['me'], marriages: {} }),
    ])
    const gaps = findGaps(people, 'me')
    const [b, d, m] = ['birthDate', 'deathDate', 'marriage'].map(k => find(gaps, k, 'me')!.cost)
    expect(b).toBe(1)
    expect(d).toBe(b)
    expect(m).toBe(b)
    expect(find(gaps, 'parents', 'me')!.cost).toBe(2)
    // Equal costs on one person come in a fixed order.
    expect(kinds(gaps, 'me')).toEqual(['birthDate', 'deathDate', 'marriage', 'parents'])
  })

  it('ranks a missing Chinese name above missing parents on the same person', () => {
    const gaps = findGaps(peopleOf([full('me', { nameZh: '', nameEn: 'Me' })]), 'me')
    expect(find(gaps, 'nameZh', 'me')!.cost).toBeLessThan(find(gaps, 'parents', 'me')!.cost)
    expect(find(gaps, 'name', 'me')).toBeUndefined()
  })

  it('scores a deceased person like a living one at the same closeness', () => {
    const gaps = findGaps(peopleOf([full('me', { birthDate: '' }), full('x', { birthDate: '', deceased: 'yes', deathDate: '1990', parents: ['me'] }), full('y', { birthDate: '', parents: ['me'] })]), 'me')
    expect(find(gaps, 'birthDate', 'x')!.cost).toBe(find(gaps, 'birthDate', 'y')!.cost)
  })

  it('has no gaps for pinyin, or for a very old person not marked deceased', () => {
    const gaps = findGaps(peopleOf([full('me', { parents: ['p'], birthDate: '1850' }), full('p')]), 'me')
    expect(kinds(gaps, 'me').filter(k => k !== 'otherParent')).toEqual([])
    expect(gaps.some(g => g.person.id === 'p' && g.kind === 'deathDate')).toBe(false)
    expect(find(gaps, 'name', 'me')).toBeUndefined()
  })

  it('lists one marriage gap per couple, on the closer partner; unmarried gives none', () => {
    const couple = (status: '' | 'unmarried') => peopleOf([
      full('me', { parents: ['dad'] }), full('dad', { spouses: ['mom'], marriages: status ? { mom: { married: '', divorced: '', status } } : {}, parents: ['gp'] }),
      full('mom', { gender: 'F', spouses: ['dad'], marriages: status ? { dad: { married: '', divorced: '', status } } : {} }), full('gp'),
    ].map(p => (p.id === 'me' ? { ...p, parents: ['dad', 'mom'] } : p)))
    const gaps = findGaps(couple(''), 'me').filter(g => g.kind === 'marriage')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].person.id).toBe('dad')
    expect(gaps[0].partner!.id).toBe('mom')
    expect(findGaps(couple('unmarried'), 'me').some(g => g.kind === 'marriage')).toBe(false)
  })

  it('asks about missing parents at any distance, and with no me', () => {
    const people = peopleOf([full('me', { parents: ['dad'] }), full('dad', { parents: ['gp'] }), full('gp', { parents: ['ggp'] }), full('ggp', { parents: ['gggp'] }), full('gggp'), full('stranger')])
    const withMe = findGaps(people, 'me')
    expect(find(withMe, 'otherParent', 'me')!.cost).toBe(2)
    expect(find(withMe, 'parents', 'gggp')!.cost).toBe(4 + 2)
    expect(find(withMe, 'parents', 'stranger')).toBeDefined()
    expect(withMe.at(-1)!.person.id).toBe('stranger')
    expect(find(findGaps(people, ''), 'parents', 'gggp')).toBeDefined()
  })

  it('orders by difficulty, then kind, then rankPeople, with no me', () => {
    const people = peopleOf([
      full('a', { birthDate: '' }), full('b', { gender: '' }), full('c', { nameZh: '', nameEn: '' }), full('d', { nameZh: '', nameEn: 'D' }),
    ])
    expect(findGaps(people, '').map(g => `${g.kind}:${g.person.id}`)).toEqual(['gender:b', 'name:c', 'birthDate:a', 'nameZh:d', 'parents:a', 'parents:b', 'parents:c', 'parents:d'])
  })

  it('still lists people who are unreachable from me, last', () => {
    const people = peopleOf([full('me'), full('far', { gender: '' }), full('near', { gender: '', parents: ['me'] })])
    const gaps = findGaps(people, 'me')
    expect(gaps.filter(g => g.kind === 'gender').map(g => g.person.id)).toEqual(['near', 'far'])
  })

  it('orders unreachable people by difficulty among themselves', () => {
    const people = peopleOf([full('me'), full('x', { birthDate: '' }), full('y', { gender: '' })])
    const far = findGaps(people, 'me').filter(g => g.person.id !== 'me').map(g => `${g.kind}:${g.person.id}`)
    expect(far).toEqual(['gender:y', 'birthDate:x', 'parents:x', 'parents:y'])
  })
})

/**
 * me with a sister, a wife and her father, a grandfather, an uncle and his son, and the sister's
 * husband. Everyone has their parents and details recorded, except where a test removes something.
 */
function inLaws() {
  return [
    full('gp'), full('uncle', { parents: ['gp'] }), full('cousin', { parents: ['uncle'] }),
    full('dad', { parents: ['gp'] }), full('me', { parents: ['dad'], spouses: ['wife'], marriages: { wife: { married: '2010', divorced: '', status: '' } } }),
    full('sis', { gender: 'F', parents: ['dad'], spouses: ['bil'], marriages: { bil: { married: '2012', divorced: '', status: '' } } }), full('bil', { spouses: ['sis'] }),
    full('wf'), full('wife', { gender: 'F', parents: ['wf'], spouses: ['me'] }),
  ]
}
/** The order of `kind` gaps, given everyone in `ids` is missing it. */
function orderOf(ids: string[], field: 'birthDate' | 'gender') {
  const people = peopleOf(inLaws().map(p => (ids.includes(p.id) ? { ...p, [field]: '' } : p)))
  return findGaps(people, 'me').filter(g => g.kind === field).map(g => g.person.id)
}

describe('ranking by kinship steps', () => {
  it('puts a sibling before a spouse\'s parent', () => {
    expect(orderOf(['wf', 'sis'], 'birthDate')).toEqual(['sis', 'wf'])
  })

  it('puts blood relatives before in-laws at the same distance', () => {
    expect(orderOf(['wf', 'bil', 'gp', 'uncle'], 'birthDate')).toEqual(['gp', 'uncle', 'wf', 'bil'])
  })

  it('keeps a spouse one step away', () => {
    expect(orderOf(['gp', 'wife'], 'gender')).toEqual(['wife', 'gp'])
  })

  it('adds steps and difficulty: a sibling\'s birth date costs the same as my missing parent, and mine comes first', () => {
    // I have one parent recorded, so my gap is the other one.
    const gaps = findGaps(peopleOf(inLaws().map(p => (p.id === 'sis' ? { ...p, birthDate: '' } : p))), 'me')
    expect(find(gaps, 'birthDate', 'sis')!.cost).toBe(2)
    expect(find(gaps, 'otherParent', 'me')!.cost).toBe(2)
    expect(gaps.indexOf(find(gaps, 'otherParent', 'me')!)).toBeLessThan(gaps.indexOf(find(gaps, 'birthDate', 'sis')!))
  })
})

describe('kinDistance', () => {
  it('counts kinship steps (a sibling is one) and partner links, and leaves out the unreachable', () => {
    const d = kinDistance(peopleOf([...inLaws(), full('stranger')]), 'me')
    const of = (id: string) => d.get(id)
    expect(of('me')).toEqual({ steps: 0, partners: 0 })
    expect(of('dad')).toEqual({ steps: 1, partners: 0 })
    expect(of('sis')).toEqual({ steps: 1, partners: 0 })
    expect(of('gp')).toEqual({ steps: 2, partners: 0 })
    expect(of('uncle')).toEqual({ steps: 2, partners: 0 })
    expect(of('cousin')).toEqual({ steps: 3, partners: 0 })
    expect(of('wife')).toEqual({ steps: 1, partners: 1 })
    expect(of('wf')).toEqual({ steps: 2, partners: 1 })
    expect(of('bil')).toEqual({ steps: 2, partners: 1 })
    expect(d.has('stranger')).toBe(false)
    expect(kinDistance(peopleOf([full('a')]), 'nobody').size).toBe(0)
  })
})
