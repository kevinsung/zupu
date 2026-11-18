import { type Marriage, type People, type Person, type PersonFields, FIELD_KEYS, childrenOf, displayName, emptyMarriage, isEmptyMarriage, marriageWithStatus, partnerIds } from './model'
import { newId } from './ids'
import { t } from './i18n'
import type { ChangeRecord, NewChange, Op, RelList } from './ops'

/** Sends ops to be applied and logged; resolves once `setPeople` has the result. */
export type Commit = (ops: Op[], change: NewChange) => Promise<void>

/** A new person with no relationships yet, ordered after everyone entered so far. */
function newPerson(fields: PersonFields): Person {
  return { ...fields, id: newId(), parents: [], spouses: [], marriages: {}, order: Date.now() }
}

export type NewRelative = 'parent' | 'spouse' | 'child' | 'sibling'
export type LinkRelative = 'parent' | 'spouse' | 'child'

export class FamilyStore {
  people: People = new Map()

  constructor(private save: Commit) {}

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

  /**
   * Stores two people as spouses, unless they already are. Every pair of parents is a couple, so
   * each path that gives a child a second parent calls this.
   */
  private coupleOps(aId: string, bId: string): Op[] {
    const a = this.people.get(aId)
    if (!a || aId === bId || !this.people.has(bId) || a.spouses.includes(bId)) return []
    return [
      { type: 'update', id: aId, add: { spouses: [bId] } },
      { type: 'update', id: bId, add: { spouses: [aId] } },
    ]
  }

  private async commit(editor: string, summary: string, ops: Op[]) {
    await this.save(ops, { editor, summary })
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
    const person = newPerson(fields)
    await this.commit(editor, `新增 Added ${displayName(person)}`, [{ type: 'set', person }])
    return person.id
  }

  /**
   * Create a new person related to `anchorId`.
   * - parent: a second parent becomes a spouse of the first.
   * - spouse: `alsoParentOf` makes the new spouse the second parent of those children of the anchor
   *   who have the anchor as their only parent.
   * - child: `coParentId` is the other parent ('' for none); they become the anchor's spouse if not already.
   * - sibling: `parentIds` are the new sibling's parents (default: the anchor's); two become spouses.
   */
  async addRelative(
    editor: string,
    rel: NewRelative,
    anchorId: string,
    fields: PersonFields,
    opts: { coParentId?: string; alsoParentOf?: string[]; parentIds?: string[] } = {},
  ): Promise<string> {
    const anchor = this.get(anchorId)
    const person = newPerson(fields)
    const id = person.id
    const ops: Op[] = []
    let label: string

    switch (rel) {
      case 'parent':
        if (anchor.parents.length >= 2) throw new Error(t.parentsFull)
        ops.push({ type: 'update', id: anchorId, add: { parents: [id] } })
        // The new person isn't in `people` yet, so coupleOps can't link them.
        if (anchor.parents.length === 1 && this.people.has(anchor.parents[0])) {
          person.spouses = [anchor.parents[0]]
          ops.push({ type: 'update', id: anchor.parents[0], add: { spouses: [id] } })
        }
        label = '新增父母 Added parent'
        break
      case 'spouse':
        person.spouses = [anchorId]
        ops.push({ type: 'update', id: anchorId, add: { spouses: [id] } })
        for (const cid of new Set(opts.alsoParentOf ?? [])) {
          const child = this.get(cid)
          if (child.parents.length !== 1 || child.parents[0] !== anchorId) {
            throw new Error(`${displayName(child)} ${t.hasOtherParent}`)
          }
          ops.push({ type: 'update', id: cid, add: { parents: [id] } })
        }
        label = '新增伴侶 Added partner'
        break
      case 'child':
        if (opts.coParentId) {
          this.get(opts.coParentId)
          if (opts.coParentId === anchorId) throw new Error(t.needsOneOrTwoParents)
          ops.push(...this.coupleOps(anchorId, opts.coParentId))
        }
        person.parents = opts.coParentId ? [anchorId, opts.coParentId] : [anchorId]
        label = '新增子女 Added child'
        break
      case 'sibling': {
        if (anchor.parents.length === 0) throw new Error(t.siblingNeedsParent)
        const parentIds = opts.parentIds ?? anchor.parents
        if (parentIds.length < 1 || parentIds.length > 2 || new Set(parentIds).size !== parentIds.length) {
          throw new Error(t.needsOneOrTwoParents)
        }
        parentIds.forEach(pid => this.get(pid))
        if (!parentIds.some(pid => anchor.parents.includes(pid))) throw new Error(t.mustShareParent)
        person.parents = [...parentIds]
        if (parentIds.length === 2) ops.push(...this.coupleOps(parentIds[0], parentIds[1]))
        label = '新增兄弟姊妹 Added sibling'
        break
      }
    }
    ops.unshift({ type: 'set', person })
    await this.commit(editor, `${label}: ${displayName(person)} → ${displayName(anchor)}`, ops)
    return id
  }

  /** Why linking would be invalid, or null if it's fine. */
  linkProblem(rel: LinkRelative, anchorId: string, otherId: string): string | null {
    if (anchorId === otherId) return t.cannotLinkSelf
    const anchor = this.get(anchorId)
    const other = this.get(otherId)
    if (rel === 'spouse') {
      if (anchor.spouses.includes(otherId)) return t.alreadySpouses
      return null
    }
    const [child, parent] = rel === 'parent' ? [anchor, other] : [other, anchor]
    if (child.parents.includes(parent.id)) return t.alreadyParent
    if (child.parents.length >= 2) return t.parentsFull
    if (this.isDescendant(parent.id, child.id)) return t.wouldLoop
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

  /**
   * Link two existing people. A child who already has a parent makes that parent and the new one
   * spouses. For a spouse, `alsoParentOf` makes `otherId` the second parent of those children of the
   * anchor who have the anchor as their only parent (as in addRelative).
   */
  async link(editor: string, rel: LinkRelative, anchorId: string, otherId: string, opts: { alsoParentOf?: string[] } = {}) {
    const problem = this.linkProblem(rel, anchorId, otherId)
    if (problem) throw new Error(problem)
    let ops: Op[]
    let label: string
    if (rel === 'spouse') {
      ops = this.coupleOps(anchorId, otherId)
      for (const cid of new Set(opts.alsoParentOf ?? [])) {
        const child = this.get(cid)
        if (child.parents.length !== 1 || child.parents[0] !== anchorId) {
          throw new Error(`${displayName(child)} ${t.hasOtherParent}`)
        }
        const childProblem = this.linkProblem('parent', cid, otherId)
        if (childProblem) throw new Error(`${displayName(child)}: ${childProblem}`)
        ops.push({ type: 'update', id: cid, add: { parents: [otherId] } })
      }
      label = '連結伴侶 Linked partner'
    } else {
      const [childId, parentId] = rel === 'parent' ? [anchorId, otherId] : [otherId, anchorId]
      ops = [{ type: 'update', id: childId, add: { parents: [parentId] } }]
      const existing = this.get(childId).parents[0]
      if (existing) ops.push(...this.coupleOps(existing, parentId))
      label = rel === 'parent' ? '連結父母 Linked parent' : '連結子女 Linked child'
    }
    await this.commit(editor, `${label}: ${this.name(otherId)} → ${this.name(anchorId)}`, ops)
  }

  /**
   * Set a couple's marriage status and dates, on both of them. Works for any partners; co-parents
   * not yet stored as spouses are linked in the same commit, so older data catches up as it's edited.
   */
  async setMarriage(editor: string, aId: string, bId: string, marriage: Marriage) {
    const a = this.get(aId)
    if (!partnerIds(this.people, a).includes(bId)) throw new Error(t.notSpouses)
    const next = marriageWithStatus(marriage)
    const cur = a.marriages[bId] ?? emptyMarriage()
    if (cur.married === next.married && cur.divorced === next.divorced && cur.status === next.status) return
    const value = isEmptyMarriage(next) ? null : next
    await this.commit(editor, `編輯婚姻 Edited marriage: ${this.name(aId)} & ${this.name(bId)}`, [
      ...this.coupleOps(aId, bId),
      { type: 'update', id: aId, marriages: { [bId]: value } },
      { type: 'update', id: bId, marriages: { [aId]: value } },
    ])
  }

  /** Why unlinking would be refused, or null if it's fine. Parents of a shared child stay a couple. */
  unlinkProblem(rel: LinkRelative, anchorId: string, otherId: string): string | null {
    if (rel !== 'spouse') return null
    const shares = childrenOf(this.people, anchorId).some(c => c.parents.includes(otherId))
    return shares ? t.sharesChildren : null
  }

  async unlink(editor: string, rel: LinkRelative, anchorId: string, otherId: string) {
    const problem = this.unlinkProblem(rel, anchorId, otherId)
    if (problem) throw new Error(problem)
    let ops: Op[]
    let label: string
    if (rel === 'spouse') {
      ops = [
        { type: 'update', id: anchorId, remove: { spouses: [otherId] } },
        { type: 'update', id: otherId, remove: { spouses: [anchorId] } },
      ]
      label = '移除伴侶關係 Unlinked partner'
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
