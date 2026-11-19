import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

export type Gender = 'M' | 'F' | ''

export interface PersonFields {
  nameZh: string
  nameEn: string
  otherNames: string
  gender: Gender
  birthDate: string
  deathDate: string
  /** 'yes' marks someone deceased even without a death date; '' is not recorded. */
  deceased: '' | 'yes'
  notes: string
  email: string
  phone: string
  address: string
  line: string
  signal: string
}

export type MarriageStatus = '' | 'married' | 'divorced' | 'unmarried'
export const MARRIAGE_STATUSES: readonly MarriageStatus[] = ['', 'married', 'divorced', 'unmarried']

/**
 * A couple: two people who are spouses or share a child. Dates are partial dates like birthDate,
 * '' when unknown. Status '' is unknown; an unmarried couple has no dates. A divorce date means
 * divorced; a marriage date alone means married, unless already divorced (date unknown).
 */
export interface Marriage {
  married: string
  divorced: string
  status: MarriageStatus
}

export type ParentKind = 'adoptive'
export const PARENT_KINDS: readonly ParentKind[] = ['adoptive']

export interface Person extends PersonFields {
  id: string
  parents: string[]
  spouses: string[]
  /** Keyed by spouse id, stored on both spouses. Only spouses with some info have an entry. */
  marriages: Record<string, Marriage>
  /** Keyed by parent id, stored on the child only. A parent with no entry is a birth parent. */
  parentKinds: Record<string, ParentKind>
  order: number
}

export type People = Map<string, Person>

export const UNKNOWN = '？？？'

export function emptyFields(): PersonFields {
  return {
    nameZh: '', nameEn: '', otherNames: '', gender: '', birthDate: '', deathDate: '', deceased: '', notes: '',
    email: '', phone: '', address: '', line: '', signal: '',
  }
}

/** Every PersonFields key, in form order; taken from emptyFields so the list can't fall out of step. */
export const FIELD_KEYS = Object.keys(emptyFields()) as (keyof PersonFields)[]

export function emptyMarriage(): Marriage {
  return { married: '', divorced: '', status: '' }
}

/** Takes `Partial` because history snapshots from before `status` existed lack it. */
export function isEmptyMarriage(m: Partial<Marriage>): boolean {
  return !m.married && !m.divorced && !m.status
}

/**
 * Applies the rules that a divorce date means divorced and a marriage date means married (or
 * divorced, if already so). Older records with a divorce date say married; they read as divorced.
 */
export function marriageWithStatus(m: Marriage): Marriage {
  if (m.divorced) return { ...m, status: 'divorced' }
  if (m.married && m.status !== 'divorced') return { ...m, status: 'married' }
  return m
}

/** Fill in missing fields so documents written by older versions (or by hand) are safe to use. */
export function normalizePerson(id: string, raw: Record<string, unknown>): Person {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const fields: Record<keyof PersonFields, string> = emptyFields()
  for (const k of FIELD_KEYS) fields[k] = str(raw[k])
  const spouses = ids(raw.spouses)
  const marriages: Record<string, Marriage> = {}
  if (typeof raw.marriages === 'object' && raw.marriages !== null) {
    for (const [sid, m] of Object.entries(raw.marriages as Record<string, Record<string, unknown>>)) {
      const status = MARRIAGE_STATUSES.find(x => x === m?.status) ?? ''
      const marriage = marriageWithStatus({ married: str(m?.married), divorced: str(m?.divorced), status })
      if (spouses.includes(sid) && !isEmptyMarriage(marriage)) marriages[sid] = marriage
    }
  }
  const parents = ids(raw.parents)
  const parentKinds: Record<string, ParentKind> = {}
  if (typeof raw.parentKinds === 'object' && raw.parentKinds !== null) {
    for (const [pid, k] of Object.entries(raw.parentKinds as Record<string, unknown>)) {
      const kind = PARENT_KINDS.find(x => x === k)
      if (kind && parents.includes(pid)) parentKinds[pid] = kind
    }
  }
  return {
    id,
    ...fields,
    gender: raw.gender === 'M' || raw.gender === 'F' ? raw.gender : '',
    deceased: raw.deceased === 'yes' ? 'yes' : '',
    parents,
    spouses,
    marriages,
    parentKinds,
    order: typeof raw.order === 'number' ? raw.order : 0,
  }
}

/** Year, month and day of 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' (0 for a missing part); null if malformed. */
function parsePartialDate(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s)
  if (!match) return null
  const [, y, m = '', d = ''] = match
  if ((m && (+m < 1 || +m > 12)) || (d && (+d < 1 || +d > 31))) return null
  return { y: +y, m: +m, d: +d }
}

/** Accepts '', 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
export function isValidPartialDate(s: string): boolean {
  return s === '' || parsePartialDate(s) !== null
}

export function isValidEmail(s: string): boolean {
  return s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

/**
 * E.164 ('+' and digits) for a valid number with a country code, '' for blank, null otherwise.
 * Full-width input (from Chinese IMEs) is accepted; extensions are rejected since E.164 can't hold them.
 */
export function normalizePhone(s: string): string | null {
  if (s.trim() === '') return ''
  const n = parsePhoneNumberFromString(s.normalize('NFKC'))
  return n?.isValid() && !n.ext ? n.number : null
}

/** Phones are stored as E.164, e.g. +886912345678. */
export function isValidPhone(s: string): boolean {
  return s === '' || normalizePhone(s) === s
}

export function formatPhone(s: string): string {
  return parsePhoneNumberFromString(s)?.formatInternational() ?? s
}

export function displayName(p: Person | null | undefined): string {
  if (!p) return UNKNOWN
  return p.nameZh || p.nameEn || p.otherNames || UNKNOWN
}

/** Every name a person goes by, for search and secondary display. */
export function allNames(p: Person): string[] {
  return [p.nameZh, p.nameEn, ...p.otherNames.split(/[,，、]/)].map(s => s.trim()).filter(Boolean)
}

/** Deceased if a death date is recorded or the person is marked deceased. */
export function isDeceased(p: Pick<Person, 'deathDate' | 'deceased'>): boolean {
  return !!p.deathDate || p.deceased === 'yes'
}

export function lifespan(p: Person): string {
  const b = p.birthDate.slice(0, 4)
  const d = p.deathDate.slice(0, 4)
  if (!b && !d) return ''
  if (d) return `${b || '?'}–${d}`
  return b && p.deceased === 'yes' ? `${b}–?` : b
}

/** Living people older than this probably died without a recorded date, so no age is shown. */
const MAX_LIVING_AGE = 105

export interface Age {
  years: number
  /** A date lacks the month or day needed to be exact. */
  approx: boolean
  /** Age at death rather than today. */
  atDeath: boolean
}

/** Age today, or at death if a death date is recorded; null when the birth date is unknown. */
export function age(p: Person, today = new Date()): Age | null {
  const b = parsePartialDate(p.birthDate)
  if (!b) return null
  if (!p.deathDate && p.deceased === 'yes') return null
  const atDeath = !!p.deathDate
  const e = atDeath ? parsePartialDate(p.deathDate) : { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() }
  if (!e) return null
  let years = e.y - b.y
  let approx = !b.m || !e.m
  if (!approx) {
    if (e.m < b.m) years--
    else if (e.m === b.m) {
      if (!b.d || !e.d) approx = true
      else if (e.d < b.d) years--
    }
  }
  if (years < 0 || (!atDeath && years > MAX_LIVING_AGE)) return null
  return { years, approx, atDeath }
}

/** Earlier birth date first; without both dates (or on a tie), the order they were entered. */
export function byBirth(a: Pick<Person, 'birthDate' | 'order'>, b: Pick<Person, 'birthDate' | 'order'>): number {
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
    const group = groups.get(other)
    if (group) group.push(c)
    else groups.set(other, [c])
  }
  return groups
}

/** Children's ids keyed by parent id, for walking down many generations at once. */
export function childrenIndex(people: People): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const p of people.values()) {
    for (const parent of p.parents) {
      const kids = index.get(parent)
      if (kids) kids.push(p.id)
      else index.set(parent, [p.id])
    }
  }
  return index
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
 * For half siblings, the one parent they share; otherwise null. They're half siblings when their
 * recorded parents differ but one is shared, so it reads the same from either one's page.
 * Two people who each have only the same one parent recorded count as full siblings.
 */
export function halfSiblingVia(me: Person, sib: Person): string | null {
  const shared = me.parents.filter(pid => sib.parents.includes(pid))
  if (shared.length !== 1 || (me.parents.length < 2 && sib.parents.length < 2)) return null
  return shared[0]
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

/**
 * How far a person's line reaches: generations below them and the number of descendants.
 * Walks down a generation at a time; `seen` keeps cousin marriages (or bad data) from double counting.
 */
function lineScore(children: Map<string, string[]>, id: string) {
  const seen = new Set([id])
  let generations = 0
  let level = [id]
  while (true) {
    level = level.flatMap(id => children.get(id) ?? []).filter(id => !seen.has(id) && seen.add(id))
    if (level.length === 0) break
    generations++
  }
  return { generations, descendants: seen.size - 1 }
}

type Scored = { p: Person, generations: number, descendants: number }
const bySeniority = (a: Scored, b: Scored) =>
  b.generations - a.generations ||
  b.descendants - a.descendants ||
  byBirth(a.p, b.p)

/**
 * The most senior root ancestor: the one heading the most generations, then the most
 * descendants, then born earliest, then entered first.
 */
export function seniorAncestor(people: People): Person | undefined {
  const children = childrenIndex(people)
  return rootAncestors(people).map(p => ({ p, ...lineScore(children, p.id) })).sort(bySeniority)[0]?.p
}

/**
 * Everyone, in seniorAncestor's order: so a parent comes before their children, and people
 * without children come last, oldest first.
 */
export function rankPeople(people: People): Person[] {
  const children = childrenIndex(people)
  return [...people.values()].map(p => ({ p, ...lineScore(children, p.id) })).sort(bySeniority).map(s => s.p)
}

/**
 * Everyone `p` is a couple with: recorded spouses in the order they were added, then anyone else
 * they share a child with. Co-parents count even if the spouse link was never stored (older data,
 * or a link removed later), so both partners always list each other.
 */
export function partnerIds(people: People, p: Person): string[] {
  const ids = p.spouses.filter(id => people.has(id))
  for (const cp of childrenByCoParent(people, p.id).keys()) if (cp && people.has(cp) && !ids.includes(cp)) ids.push(cp)
  return ids
}

/** Partners (see partnerIds) in that order, except that those with marriage dates are reordered among themselves by date. */
export function partnersOf(people: People, p: Person): Person[] {
  const date = (s: Person) => p.marriages[s.id]?.married ?? ''
  const list = partnerIds(people, p).map(id => people.get(id)!)
  const dated = list.filter(date).sort((a, b) => (date(a) < date(b) ? -1 : date(a) > date(b) ? 1 : 0))
  let i = 0
  return list.map(s => (date(s) ? dated[i++] : s))
}

/** Whether any of a person's names contains the query, ignoring case; an empty query matches no one. */
export function matchesName(p: Person, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !!q && allNames(p).some(n => n.toLowerCase().includes(q))
}

/** Everyone whose names match the query, most senior first (see rankPeople). */
export function searchPeople(people: People, query: string): Person[] {
  return rankPeople(people).filter(p => matchesName(p, query))
}
