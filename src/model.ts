import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

export type Gender = 'M' | 'F' | ''

export interface PersonFields {
  nameZh: string
  nameEn: string
  otherNames: string
  gender: Gender
  birthDate: string
  deathDate: string
  notes: string
  email: string
  phone: string
  address: string
  line: string
  signal: string
  whatsapp: string
}

export interface Person extends PersonFields {
  id: string
  parents: string[]
  spouses: string[]
  order: number
}

export type People = Map<string, Person>

export const FIELD_KEYS: (keyof PersonFields)[] = [
  'nameZh', 'nameEn', 'otherNames', 'gender', 'birthDate', 'deathDate', 'notes',
  'email', 'phone', 'address', 'line', 'signal', 'whatsapp',
]

export const UNKNOWN = '？？？'

export function emptyFields(): PersonFields {
  return {
    nameZh: '', nameEn: '', otherNames: '', gender: '', birthDate: '', deathDate: '', notes: '',
    email: '', phone: '', address: '', line: '', signal: '', whatsapp: '',
  }
}

/** Fill in missing fields so documents written by older versions (or by hand) are safe to use. */
export function normalizePerson(id: string, raw: Record<string, unknown>): Person {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const gender = raw.gender === 'M' || raw.gender === 'F' ? raw.gender : ''
  return {
    id,
    nameZh: str(raw.nameZh),
    nameEn: str(raw.nameEn),
    otherNames: str(raw.otherNames),
    gender,
    birthDate: str(raw.birthDate),
    deathDate: str(raw.deathDate),
    notes: str(raw.notes),
    email: str(raw.email),
    phone: str(raw.phone),
    address: str(raw.address),
    line: str(raw.line),
    signal: str(raw.signal),
    whatsapp: str(raw.whatsapp),
    parents: ids(raw.parents),
    spouses: ids(raw.spouses),
    order: typeof raw.order === 'number' ? raw.order : 0,
  }
}

/** Accepts '', 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
export function isValidPartialDate(s: string): boolean {
  if (s === '') return true
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s)
  if (!m) return false
  const month = m[2] ? Number(m[2]) : 1
  const day = m[3] ? Number(m[3]) : 1
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

export function isValidEmail(s: string): boolean {
  return s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

/** E.164 ('+' and digits) for a valid number with a country code, '' for blank, null otherwise. */
export function normalizePhone(s: string): string | null {
  if (s.trim() === '') return ''
  const n = parsePhoneNumberFromString(s)
  return n?.isValid() ? n.number : null
}

/** Phones are stored as E.164, e.g. +886912345678. */
export function isValidPhone(s: string): boolean {
  return s === '' || normalizePhone(s) === s
}

export function formatPhone(s: string): string {
  return parsePhoneNumberFromString(s)?.formatInternational() ?? s
}

export function displayName(p: Person | undefined): string {
  if (!p) return UNKNOWN
  return p.nameZh || p.nameEn || p.otherNames || UNKNOWN
}

/** Every name a person goes by, for search and secondary display. */
export function allNames(p: Person): string[] {
  return [p.nameZh, p.nameEn, ...p.otherNames.split(/[,，、]/)].map(s => s.trim()).filter(Boolean)
}

export function lifespan(p: Person): string {
  const b = p.birthDate.slice(0, 4)
  const d = p.deathDate.slice(0, 4)
  if (!b && !d) return ''
  return d ? `${b || '?'}–${d}` : b
}

function byBirth(a: Person, b: Person): number {
  if (a.birthDate && b.birthDate && a.birthDate !== b.birthDate) return a.birthDate < b.birthDate ? -1 : 1
  return a.order - b.order
}

export function childrenOf(people: People, id: string): Person[] {
  return [...people.values()].filter(p => p.parents.includes(id)).sort(byBirth)
}

/** Children grouped by the other parent ('' = no other parent recorded). */
export function childrenByCoParent(people: People, id: string): Map<string, Person[]> {
  const groups = new Map<string, Person[]>()
  for (const c of childrenOf(people, id)) {
    const other = c.parents.find(p => p !== id) ?? ''
    groups.set(other, [...(groups.get(other) ?? []), c])
  }
  return groups
}

/** Anyone sharing at least one parent. */
export function siblingsOf(people: People, id: string): Person[] {
  const me = people.get(id)
  if (!me || me.parents.length === 0) return []
  return [...people.values()]
    .filter(p => p.id !== id && p.parents.some(pid => me.parents.includes(pid)))
    .sort(byBirth)
}

/**
 * Top of each family line: people with no recorded parents who have children, and whose
 * co-parents also have no parents (so in-laws marrying into a line don't count).
 * Couples are returned once, as the first-entered partner.
 */
export function rootAncestors(people: People): Person[] {
  const roots: Person[] = []
  const seen = new Set<string>()
  const all = [...people.values()].sort((a, b) => a.order - b.order)
  for (const p of all) {
    if (seen.has(p.id) || p.parents.length > 0) continue
    const kids = childrenOf(people, p.id)
    if (kids.length === 0) continue
    const coParents = kids.flatMap(k => k.parents).filter(id => id !== p.id)
    if (coParents.some(id => (people.get(id)?.parents.length ?? 0) > 0)) continue
    roots.push(p)
    seen.add(p.id)
    p.spouses.forEach(s => seen.add(s))
    coParents.forEach(s => seen.add(s))
  }
  return roots
}

export function coupleLabel(people: People, p: Person): string {
  const partners = p.spouses.map(id => people.get(id)).filter((s): s is Person => !!s)
  return [p, ...partners].map(displayName).join(' & ')
}

export function searchPeople(people: People, query: string, limit = 20): Person[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return [...people.values()]
    .filter(p => allNames(p).some(n => n.toLowerCase().includes(q)))
    .slice(0, limit)
}
