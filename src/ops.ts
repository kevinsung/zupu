// The write format shared by the browser and the Worker: ops, and how they apply to people.
import { type Marriage, type ParentKind, type People, type Person, type PersonFields, isEmptyMarriage } from './model'

export type RelList = 'parents' | 'spouses'

/**
 * A single write. Updates use array add/remove and per-spouse marriage patches (null clears one)
 * so concurrent edits by different relatives merge.
 */
export type Op =
  | { type: 'set'; person: Person }
  | {
    type: 'update'; id: string; fields?: Partial<PersonFields>
    /** The hand-set sibling order (see byBirth). */
    order?: number
    add?: Partial<Record<RelList, string[]>>; remove?: Partial<Record<RelList, string[]>>
    marriages?: Record<string, Marriage | null>
    /** Per-parent kind patches; null is back to birth parent. */
    parentKinds?: Record<string, ParentKind | null>
  }
  | { type: 'delete'; id: string }

export interface PersonDiff { id: string; before: Person | null; after: Person | null }

export interface ChangeRecord {
  id: string
  editor: string
  at: number
  summary: string
  diffs: PersonDiff[]
}

/** What the client sends; the server computes `diffs` itself from the current data. */
export type NewChange = Pick<ChangeRecord, 'editor' | 'summary'>

/** Apply ops to a copy of `people`, returning before/after for each touched person. */
export function simulate(people: People, ops: Op[]): PersonDiff[] {
  const next = new Map(people)
  const touched: string[] = []
  for (const op of ops) {
    const id = op.type === 'set' ? op.person.id : op.id
    if (!touched.includes(id)) touched.push(id)
    applyOp(next, op)
  }
  return touched.map(id => ({ id, before: people.get(id) ?? null, after: next.get(id) ?? null }))
}

export function applyOp(people: People, op: Op) {
  if (op.type === 'set') {
    people.set(op.person.id, op.person)
  } else if (op.type === 'delete') {
    people.delete(op.id)
  } else {
    const cur = people.get(op.id)
    if (!cur) return
    const p: Person = { ...cur, ...op.fields, ...(op.order === undefined ? {} : { order: op.order }), parents: [...cur.parents], spouses: [...cur.spouses], marriages: { ...cur.marriages }, parentKinds: { ...cur.parentKinds } }
    for (const key of ['parents', 'spouses'] as const) {
      for (const x of op.add?.[key] ?? []) if (!p[key].includes(x)) p[key].push(x)
      if (op.remove?.[key]) p[key] = p[key].filter(x => !op.remove![key]!.includes(x))
    }
    for (const [sid, m] of Object.entries(op.marriages ?? {})) {
      if (m && !isEmptyMarriage(m)) p.marriages[sid] = m
      else delete p.marriages[sid]
    }
    for (const [pid, k] of Object.entries(op.parentKinds ?? {})) {
      if (k) p.parentKinds[pid] = k
      else delete p.parentKinds[pid]
    }
    // Unlinking a parent (or deleting them) drops the kind too.
    for (const pid of Object.keys(p.parentKinds)) if (!p.parents.includes(pid)) delete p.parentKinds[pid]
    // Unlinking a spouse (or deleting them) drops the marriage too.
    for (const sid of Object.keys(p.marriages)) if (!p.spouses.includes(sid)) delete p.marriages[sid]
    people.set(op.id, p)
  }
}
