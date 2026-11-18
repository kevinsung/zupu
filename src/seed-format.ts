import { type Person, normalizePerson } from './model'

/**
 * Shape of seed/family.json: people keyed by short local keys; spouses may be listed on one side
 * only, and a child's two parents are made spouses if they aren't listed as such.
 */
export interface SeedEntry {
  key: string
  nameZh?: string
  nameEn?: string
  otherNames?: string
  gender?: 'M' | 'F'
  birthDate?: string
  deathDate?: string
  notes?: string
  email?: string
  phone?: string
  address?: string
  line?: string
  signal?: string
  parents?: string[]
  spouses?: string[]
}

export function seedToPeople(entries: SeedEntry[], newId: () => string): Person[] {
  const ids = new Map(entries.map(e => [e.key, newId()]))
  const resolve = (key: string) => {
    const id = ids.get(key)
    if (!id) throw new Error(`Unknown seed key: ${key}`)
    return id
  }
  const people = entries.map((e, i) => {
    const { key, parents = [], spouses = [], ...fields } = e
    return normalizePerson(resolve(key), { ...fields, parents: parents.map(resolve), spouses: spouses.map(resolve), order: i })
  })
  const byId = new Map(people.map(p => [p.id, p]))
  const couple = (a: Person, b: Person) => {
    if (a === b) return
    if (!a.spouses.includes(b.id)) a.spouses.push(b.id)
    if (!b.spouses.includes(a.id)) b.spouses.push(a.id)
  }
  for (const p of people) for (const s of p.spouses) couple(p, byId.get(s)!)
  for (const p of people) if (p.parents.length === 2) couple(byId.get(p.parents[0])!, byId.get(p.parents[1])!)
  return people
}
