import {
  type People, type Person, type PersonFields,
  FIELD_KEYS, childrenOf, displayName, emptyFields,
} from './model'

export type RelList = 'parents' | 'spouses'

/** A single write. Updates use array add/remove so concurrent edits by different relatives merge. */
export type Op =
  | { type: 'set'; person: Person }
  | { type: 'update'; id: string; fields?: Partial<PersonFields>; add?: Partial<Record<RelList, string[]>>; remove?: Partial<Record<RelList, string[]>> }
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

export interface Backend {
  newId(): string
  subscribePeople(cb: (people: Person[]) => void, onError: (e: Error) => void): () => void
  subscribeChanges(cb: (changes: ChangeRecord[]) => void, onError: (e: Error) => void): () => void
  commit(ops: Op[], change: NewChange): Promise<void>
}

export type NewRelative = 'parent' | 'spouse' | 'child' | 'sibling'
export type LinkRelative = 'parent' | 'spouse' | 'child'

export class FamilyStore {
  people: People = new Map()

  constructor(private backend: Backend) {}

  setPeople(list: Person[]) {
    this.people = new Map(list.map(p => [p.id, p]))
  }

  private get(id: string): Person {
    const p = this.people.get(id)
    if (!p) throw new Error(`Person not found: ${id}`)
    return p
  }

  private name(id: string) {
    return displayName(this.people.get(id))
  }

  private async commit(editor: string, summary: string, ops: Op[]) {
    await this.backend.commit(ops, { editor, summary })
  }

  async updateFields(editor: string, id: string, fields: PersonFields) {
    const p = this.get(id)
    const changed: Partial<PersonFields> = {}
    for (const k of FIELD_KEYS) if (p[k] !== fields[k]) (changed as Record<string, string>)[k] = fields[k]
    if (Object.keys(changed).length === 0) return
    await this.commit(editor, `編輯 Edited ${displayName({ ...p, ...fields })}`, [{ type: 'update', id, fields: changed }])
  }

  /** Create a person with no relationships (only used to start an empty tree). */
  async createPerson(editor: string, fields: PersonFields): Promise<string> {
    const id = this.backend.newId()
    const person: Person = { ...emptyFields(), ...fields, id, parents: [], spouses: [], order: Date.now() }
    await this.commit(editor, `新增 Added ${displayName(person)}`, [{ type: 'set', person }])
    return id
  }

  /**
   * Create a new person related to `anchorId`.
   * - parent: `alsoSpouseOf` makes the new parent a spouse of the existing parent.
   * - child: `coParentId` is the other parent ('' for none).
   */
  async addRelative(
    editor: string,
    rel: NewRelative,
    anchorId: string,
    fields: PersonFields,
    opts: { coParentId?: string; alsoSpouseOf?: string } = {},
  ): Promise<string> {
    const anchor = this.get(anchorId)
    const id = this.backend.newId()
    const person: Person = { ...emptyFields(), ...fields, id, parents: [], spouses: [], order: Date.now() }
    const ops: Op[] = []
    let label: string

    switch (rel) {
      case 'parent':
        if (anchor.parents.length >= 2) throw new Error('已有兩位父母 Already has two parents')
        ops.push({ type: 'update', id: anchorId, add: { parents: [id] } })
        if (opts.alsoSpouseOf && anchor.parents.includes(opts.alsoSpouseOf)) {
          person.spouses = [opts.alsoSpouseOf]
          ops.push({ type: 'update', id: opts.alsoSpouseOf, add: { spouses: [id] } })
        }
        label = '新增父母 Added parent'
        break
      case 'spouse':
        person.spouses = [anchorId]
        ops.push({ type: 'update', id: anchorId, add: { spouses: [id] } })
        label = '新增配偶 Added spouse'
        break
      case 'child':
        person.parents = opts.coParentId ? [anchorId, opts.coParentId] : [anchorId]
        label = '新增子女 Added child'
        break
      case 'sibling':
        if (anchor.parents.length === 0) throw new Error('請先新增父母 Add a parent first')
        person.parents = [...anchor.parents]
        label = '新增兄弟姊妹 Added sibling'
        break
    }
    ops.unshift({ type: 'set', person })
    await this.commit(editor, `${label}: ${displayName(person)} → ${displayName(anchor)}`, ops)
    return id
  }

  /** Why linking would be invalid, or null if it's fine. */
  linkProblem(rel: LinkRelative, anchorId: string, otherId: string): string | null {
    if (anchorId === otherId) return '不能連結自己 Cannot link a person to themselves'
    const anchor = this.get(anchorId)
    const other = this.get(otherId)
    if (rel === 'spouse') {
      if (anchor.spouses.includes(otherId)) return '已是配偶 Already spouses'
      return null
    }
    const [child, parent] = rel === 'parent' ? [anchor, other] : [other, anchor]
    if (child.parents.includes(parent.id)) return '已是父母 Already a parent'
    if (child.parents.length >= 2) return '已有兩位父母 Already has two parents'
    if (this.isDescendant(parent.id, child.id)) return '會造成循環 Would create a loop (descendant cannot be a parent)'
    return null
  }

  private isDescendant(id: string, ancestorId: string): boolean {
    const stack = [ancestorId]
    const seen = new Set<string>()
    while (stack.length) {
      const cur = stack.pop()!
      if (cur === id) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      stack.push(...childrenOf(this.people, cur).map(c => c.id))
    }
    return false
  }

  async link(editor: string, rel: LinkRelative, anchorId: string, otherId: string) {
    const problem = this.linkProblem(rel, anchorId, otherId)
    if (problem) throw new Error(problem)
    let ops: Op[]
    let label: string
    if (rel === 'spouse') {
      ops = [
        { type: 'update', id: anchorId, add: { spouses: [otherId] } },
        { type: 'update', id: otherId, add: { spouses: [anchorId] } },
      ]
      label = '連結配偶 Linked spouse'
    } else {
      const [childId, parentId] = rel === 'parent' ? [anchorId, otherId] : [otherId, anchorId]
      ops = [{ type: 'update', id: childId, add: { parents: [parentId] } }]
      label = rel === 'parent' ? '連結父母 Linked parent' : '連結子女 Linked child'
    }
    await this.commit(editor, `${label}: ${this.name(otherId)} → ${this.name(anchorId)}`, ops)
  }

  async unlink(editor: string, rel: LinkRelative, anchorId: string, otherId: string) {
    let ops: Op[]
    let label: string
    if (rel === 'spouse') {
      ops = [
        { type: 'update', id: anchorId, remove: { spouses: [otherId] } },
        { type: 'update', id: otherId, remove: { spouses: [anchorId] } },
      ]
      label = '移除配偶關係 Unlinked spouse'
    } else {
      const [childId, parentId] = rel === 'parent' ? [anchorId, otherId] : [otherId, anchorId]
      ops = [{ type: 'update', id: childId, remove: { parents: [parentId] } }]
      label = rel === 'parent' ? '移除父母關係 Unlinked parent' : '移除子女關係 Unlinked child'
    }
    await this.commit(editor, `${label}: ${this.name(otherId)} ✕ ${this.name(anchorId)}`, ops)
  }

  async deletePerson(editor: string, id: string) {
    const p = this.get(id)
    const ops: Op[] = []
    for (const other of this.people.values()) {
      if (other.id === id) continue
      const remove: Partial<Record<RelList, string[]>> = {}
      if (other.parents.includes(id)) remove.parents = [id]
      if (other.spouses.includes(id)) remove.spouses = [id]
      if (Object.keys(remove).length) ops.push({ type: 'update', id: other.id, remove })
    }
    ops.push({ type: 'delete', id })
    await this.commit(editor, `刪除 Deleted ${displayName(p)}`, ops)
  }

  /** Restore every person touched by `change` to how they were before it. */
  async revert(editor: string, change: ChangeRecord) {
    const ops: Op[] = change.diffs.map(d =>
      d.before ? { type: 'set', person: d.before } : { type: 'delete', id: d.id },
    )
    await this.commit(editor, `還原 Reverted: ${change.summary}`, ops)
  }
}

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
    const p: Person = { ...cur, ...op.fields, parents: [...cur.parents], spouses: [...cur.spouses] }
    for (const key of ['parents', 'spouses'] as const) {
      for (const x of op.add?.[key] ?? []) if (!p[key].includes(x)) p[key].push(x)
      if (op.remove?.[key]) p[key] = p[key].filter(x => !op.remove![key]!.includes(x))
    }
    people.set(op.id, p)
  }
}
