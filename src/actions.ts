import { h } from './dom'
import { L, t } from './i18n'
import { confirmDialog, marriageForm, openDialog, personForm, personPicker, toast } from './dialog'
import { personCard } from './cards'
import { type Person, type PersonFields, childrenOf, displayName, emptyFields } from './model'
import type { FamilyStore, LinkRelative, NewRelative } from './store'

export interface AppCtx {
  store: FamilyStore
  select(id: string): void
  /** Resolves to the editor's name, prompting for it the first time; null if they cancel. */
  editorName(): Promise<string | null>
  /** Opens the change log, optionally only the changes that touched one person. */
  showHistory(personId?: string): void
}

export function editPerson(ctx: AppCtx, p: Person) {
  const form = personForm(p)
  openDialog(L('edit'), form.el, [
    {
      label: L('save'), primary: true, run: async () => {
        const fields = form.read()
        const editor = await ctx.editorName()
        if (!editor) return false
        await ctx.store.updateFields(editor, p.id, fields)
      },
    },
  ], { subtitle: displayName(p) })
  form.focus()
}

export function editMarriage(ctx: AppCtx, p: Person, spouse: Person) {
  const form = marriageForm(p.marriages[spouse.id] ?? { married: '', divorced: '' })
  openDialog(L('editMarriage'), form.el, [
    {
      label: L('save'), primary: true, run: async () => {
        const marriage = form.read()
        const editor = await ctx.editorName()
        if (!editor) return false
        await ctx.store.setMarriage(editor, p.id, spouse.id, marriage)
      },
    },
  ], { subtitle: `${displayName(p)} & ${displayName(spouse)}` })
  form.focus()
}

const ADD_TITLES = { parent: 'addParent', spouse: 'addSpouse', child: 'addChild', sibling: 'addSibling' } as const satisfies Record<NewRelative, string>

export function addRelative(ctx: AppCtx, p: Person, rel: NewRelative) {
  const people = ctx.store.people
  const initial: PersonFields = emptyFields()
  let extra: HTMLElement | null = null
  let readOpts = () => ({})

  if (rel === 'spouse' && p.gender) initial.gender = p.gender === 'M' ? 'F' : 'M'
  if (rel === 'parent' && p.parents.length === 1) {
    const existing = people.get(p.parents[0])
    if (existing) {
      if (existing.gender) initial.gender = existing.gender === 'M' ? 'F' : 'M'
      const box = h('input', { type: 'checkbox', checked: true })
      extra = h('label', { class: 'checkbox' }, box, `${t.alsoSpouseOf} ${displayName(existing)}`)
      readOpts = () => (box.checked ? { alsoSpouseOf: existing.id } : {})
    }
  }
  if (rel === 'child') {
    const select = h('select', {},
      ...p.spouses.map(sid => h('option', { value: sid }, displayName(people.get(sid)))),
      h('option', { value: '' }, t.otherParentNone),
    )
    extra = h('label', { class: 'field' }, h('span', { class: 'field-label' }, L('otherParent')), select)
    readOpts = () => ({ coParentId: select.value })
  }

  const form = personForm(initial)
  openDialog(L(ADD_TITLES[rel]), h('div', { class: 'form' }, extra, form.el), [
    {
      label: L('save'), primary: true, run: async () => {
        const fields = form.read()
        const editor = await ctx.editorName()
        if (!editor) return false
        await ctx.store.addRelative(editor, rel, p.id, fields, readOpts())
      },
    },
  ], { subtitle: displayName(p) })
  form.focus()
}

export function linkExisting(ctx: AppCtx, p: Person) {
  const rel = h('select', {},
    h('option', { value: 'spouse' }, t.asSpouse),
    h('option', { value: 'parent' }, t.asParent),
    h('option', { value: 'child' }, t.asChild),
  )
  const picker = personPicker(() => ctx.store.people, () => {}, { exclude: p.id, selectable: true })
  openDialog(L('linkExisting'),
    h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, L('linkAs')), rel), picker.el),
    [
      {
        label: L('save'), primary: true, run: async () => {
          const other = picker.selected()
          if (!other) throw new Error(t.pickPerson)
          const r = rel.value as LinkRelative
          const problem = ctx.store.linkProblem(r, p.id, other.id)
          if (problem) throw new Error(problem)
          const editor = await ctx.editorName()
          if (!editor) return false
          await ctx.store.link(editor, r, p.id, other.id)
        },
      },
    ], { subtitle: displayName(p) })
  picker.input.focus()
}

export async function deletePerson(ctx: AppCtx, p: Person) {
  if (!(await confirmDialog(`${t.confirmDelete} — ${displayName(p)}`, t.delete, true))) return
  const editor = await ctx.editorName()
  if (!editor) return
  const next = p.parents[0] ?? p.spouses[0] ?? [...ctx.store.people.keys()].find(id => id !== p.id)
  try {
    await ctx.store.deletePerson(editor, p.id)
  } catch (e) {
    toast(`${t.saveFailed}: ${(e as Error).message}`)
    return
  }
  if (next) ctx.select(next)
}

/** Lists every relationship of `p` with a remove button. */
export function removeRelationship(ctx: AppCtx, p: Person) {
  const people = ctx.store.people
  const list = h('div', { class: 'form' })
  let close = () => {}
  const section = (label: string, rel: LinkRelative, others: Person[]) => others.length
    ? h('section', {}, h('h3', { class: 'section-title' }, label), h('div', { class: 'cards' }, ...others.map(other =>
      personCard(other, () => {}, h('button', {
        type: 'button', class: 'danger small', onclick: async () => {
          if (!(await confirmDialog(`${t.confirmUnlink} ${displayName(p)} — ${displayName(other)}`, t.remove, true))) return
          const editor = await ctx.editorName()
          if (!editor) return
          try {
            await ctx.store.unlink(editor, rel, p.id, other.id)
            close()
          } catch (e) {
            toast(`${t.saveFailed}: ${(e as Error).message}`)
          }
        },
      }, t.remove)))))
    : null
  const get = (ids: string[]) => ids.map(id => people.get(id)).filter((x): x is Person => !!x)
  const sections = [
    section(t.parents, 'parent', get(p.parents)),
    section(t.spouses, 'spouse', get(p.spouses)),
    section(t.children, 'child', childrenOf(people, p.id)),
  ].filter((x): x is HTMLElement => !!x)
  list.append(...(sections.length ? sections : [h('p', { class: 'muted' }, t.noRelationships)]))
  close = openDialog(L('removeRelationship'), list, [], { subtitle: displayName(p) })
}
