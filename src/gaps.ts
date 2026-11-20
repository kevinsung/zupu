import { type Distance, kinDistance } from './kinship'
import { type People, type Person, partnerIds, rankPeople } from './model'

export type GapKind = 'gender' | 'name' | 'nameZh' | 'birthDate' | 'deathDate' | 'marriage' | 'marriedDate' | 'divorcedDate' | 'parents' | 'otherParent'
/** Something unrecorded about `person` (or, for a marriage, about the couple of `person` and `partner`), and how likely the user is to know it. */
export interface Gap { kind: GapKind, person: Person, partner?: Person, cost: number }

/** How many steps of kinship distance each kind of gap is worth: gender is known to anyone who knows the person, parents are harder. */
export const DIFFICULTY: Record<GapKind, number> = {
  gender: 0, name: 0, birthDate: 1, deathDate: 1, marriage: 1, marriedDate: 1, divorcedDate: 1, nameZh: 1, parents: 2, otherParent: 2,
}
/** For gaps that tie on everything else (on one person, mostly). */
export const KIND_ORDER: GapKind[] = ['gender', 'name', 'birthDate', 'deathDate', 'marriage', 'marriedDate', 'divorcedDate', 'nameZh', 'parents', 'otherParent']

/**
 * Everything missing, most likely known first: cost = kinship steps from `meId` + the gap's
 * difficulty, lowest first (with no me, everyone is 0 steps away; anyone unreachable comes last).
 * Ties go to the closer person, then the one with fewer partner links (blood before in-laws), then
 * KIND_ORDER, then `rankPeople` order. A couple's gaps (whether they married, else the dates they lack)
 * are listed once per couple, on the closer partner.
 */
export function findGaps(people: People, meId: string): Gap[] {
  const hasMe = people.has(meId)
  const distance = hasMe ? kinDistance(people, meId) : new Map<string, Distance>()
  const SAME: Distance = { steps: 0, partners: 0 }
  // Unreachable people are compared by difficulty alone, after everyone reachable.
  const distOf = (id: string): Distance | null => (hasMe ? distance.get(id) ?? null : SAME)
  const ranked = rankPeople(people)
  const order = new Map(ranked.map((p, i) => [p.id, i]))
  /** Negative when `a` is closer to me than `b`. */
  const closer = (a: string, b: string) => {
    const da = distOf(a), db = distOf(b)
    if (!da || !db) return (da ? 0 : 1) - (db ? 0 : 1)
    return da.steps - db.steps || da.partners - db.partners
  }

  const found: (Gap & { reached: boolean })[] = []
  const add = (kind: GapKind, person: Person, partner?: Person) => {
    const d = distOf(person.id)
    found.push({ kind, person, partner, reached: !!d, cost: (d?.steps ?? 0) + DIFFICULTY[kind] })
  }
  for (const p of ranked) {
    if (!p.gender) add('gender', p)
    if (!p.nameZh && !p.nameEn) add('name', p)
    else if (!p.nameZh) add('nameZh', p)
    if (!p.birthDate) add('birthDate', p)
    if (p.deceased === 'yes' && !p.deathDate) add('deathDate', p)
    const parents = p.parents.filter(id => people.has(id)).length
    if (parents < 2) add(parents ? 'otherParent' : 'parents', p)
    for (const qid of partnerIds(people, p)) {
      const q = people.get(qid)!
      const m = p.marriages[qid] ?? q.marriages[p.id]
      // A status of '' means unknown: a stored date always sets one (see marriageWithStatus).
      const status = m?.status ?? ''
      const kinds: GapKind[] = !status ? ['marriage']
        : status === 'unmarried' ? []
        : [...(m!.married ? [] : ['marriedDate' as const]), ...(status === 'divorced' && !m!.divorced ? ['divorcedDate' as const] : [])]
      if (!kinds.length) continue
      // Each couple once: from the closer partner (the earlier in rank on a tie).
      const c = closer(p.id, qid)
      if (c > 0 || (c === 0 && order.get(p.id)! > order.get(qid)!)) continue
      for (const kind of kinds) add(kind, p, q)
    }
  }
  const rank = (p?: Person) => (p ? order.get(p.id)! : -1)
  return found
    .sort((a, b) => Number(b.reached) - Number(a.reached) || a.cost - b.cost || closer(a.person.id, b.person.id)
      || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || rank(a.person) - rank(b.person) || rank(a.partner) - rank(b.partner))
    .map(({ reached: _r, ...gap }) => gap)
}

// ---------------------------------------------------------------------------------------------
// Gaps the user doesn't know, hidden per device

const SKIP_KEY = 'ft-missing-skip'

/**
 * `kind:person`, or for a couple `kind:a:b` with the ids sorted: which partner carries the gap
 * depends on who 我是 is, and changing that mustn't orphan the key (pruneSkipped would drop it).
 */
export const skipKey = (g: Gap) => coupleOrder([g.kind, g.person.id, ...(g.partner ? [g.partner.id] : [])].join(':'))

/** Sorts a couple key's two ids (ids are base 36, so never contain ':'); other keys pass through. */
const coupleOrder = (key: string) => {
  const [kind, a, b] = key.split(':')
  return b === undefined ? key : [kind, ...[a, b].sort()].join(':')
}

export function getSkipped(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]')
    // coupleOrder: keys stored before couples were sorted.
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(coupleOrder) : [])
  } catch { return new Set() }
}

export function setSkipped(keys: Set<string>) {
  if (keys.size) localStorage.setItem(SKIP_KEY, JSON.stringify([...keys]))
  else localStorage.removeItem(SKIP_KEY)
}

/** The skipped keys that still match a gap, so keys for gaps since filled in don't pile up. */
export function pruneSkipped(skipped: Set<string>, gaps: Gap[]): Set<string> {
  const live = new Set(gaps.map(skipKey))
  return new Set([...skipped].filter(k => live.has(k)))
}
