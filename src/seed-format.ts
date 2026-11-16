import { type Person, normalizePerson } from './model'

/** Shape of seed/family.json: people keyed by short local keys; spouses may be listed on one side only. */
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
  for (const p of people) {
    for (const s of p.spouses) {
      const sp = byId.get(s)!
      if (!sp.spouses.includes(p.id)) sp.spouses.push(p.id)
    }
  }
  return people
}
