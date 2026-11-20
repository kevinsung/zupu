// @vitest-environment jsdom
// jsdom because findGaps lives beside the page code, which imports i18n (it reads localStorage).
import { describe, expect, it } from 'vitest'
import { type People, type Person, emptyFields } from '../src/model'
import { kinSteps } from '../src/kinship'
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
    const [b, d, m] = ['birthDate', 'deathDate', 'marriage'].map(k => find(gaps, k, 'me')!.score)
    expect(b).toBe(d)
    expect(d).toBe(m)
    const parents = find(gaps, 'parents', 'me')!.score
    expect(b).toBeGreaterThan(parents)
  })

  it('ranks a missing Chinese name above missing parents on the same person', () => {
    const gaps = findGaps(peopleOf([full('me', { nameZh: '', nameEn: 'Me' })]), 'me')
    expect(find(gaps, 'nameZh', 'me')!.score).toBeGreaterThan(find(gaps, 'parents', 'me')!.score)
    expect(find(gaps, 'name', 'me')).toBeUndefined()
  })

  it('scores a deceased person like a living one at the same closeness', () => {
    const gaps = findGaps(peopleOf([full('me', { birthDate: '' }), full('x', { birthDate: '', deceased: 'yes', deathDate: '1990', parents: ['me'] }), full('y', { birthDate: '', parents: ['me'] })]), 'me')
    expect(find(gaps, 'birthDate', 'x')!.score).toBe(find(gaps, 'birthDate', 'y')!.score)
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

  it('asks about parents only within 3 steps, and not at all with no me', () => {
    const people = peopleOf([full('me', { parents: ['dad'] }), full('dad', { parents: ['gp'] }), full('gp', { parents: ['ggp'] }), full('ggp', { parents: ['gggp'] }), full('gggp')])
    const withMe = findGaps(people, 'me')
    expect(find(withMe, 'otherParent', 'me')).toBeDefined()
    expect(find(withMe, 'otherParent', 'ggp')).toBeDefined() // 3 steps
    expect(find(withMe, 'parents', 'gggp')).toBeUndefined() // 4 steps
    expect(findGaps(people, '').some(g => g.kind === 'parents' || g.kind === 'otherParent')).toBe(false)
  })

  it('orders by weight, then rankPeople, with no me', () => {
    const people = peopleOf([
      full('a', { birthDate: '' }), full('b', { gender: '' }), full('c', { nameZh: '', nameEn: '' }), full('d', { nameZh: '', nameEn: 'D' }),
    ])
    expect(findGaps(people, '').map(g => `${g.kind}:${g.person.id}`)).toEqual(['gender:b', 'name:c', 'birthDate:a', 'nameZh:d'])
  })

  it('still lists people who are unreachable from me, last', () => {
    const people = peopleOf([full('me'), full('far', { gender: '' }), full('near', { gender: '', parents: ['me'] })])
    const gaps = findGaps(people, 'me')
    expect(gaps.filter(g => g.kind === 'gender').map(g => g.person.id)).toEqual(['near', 'far'])
  })
})

describe('kinSteps', () => {
  it('counts edges from me, and leaves out the unreachable', () => {
    const steps = kinSteps(peopleOf([...family(), full('stranger')]), 'me')
    expect(steps.get('me')).toBe(0)
    expect(steps.get('dad')).toBe(1)
    expect(steps.get('gp')).toBe(2)
    expect(steps.get('uncle')).toBe(3)
    expect(steps.get('cousin')).toBe(4)
    expect(steps.has('stranger')).toBe(false)
    expect(kinSteps(peopleOf([full('a')]), 'nobody').size).toBe(0)
  })
})
