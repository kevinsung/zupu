import { h } from './dom'
import { L, t } from './i18n'
import { confirmDialog, marriageForm, openDialog, personForm, personPicker, toast } from './dialog'
import { halfTag, personCard } from './cards'
import { type ParentKind, PARENT_KINDS, type People, type Person, type PersonFields, childrenOf, displayName, emptyFields, emptyMarriage, partnerIds, partnersOf } from './model'
import { recentAndEveryone } from './search'
import type { FamilyStore, LinkRelative, NewRelative } from './store'

export interface AppCtx {
  store: FamilyStore
  select(id: string): void
  /** Goes to the landing page, with everyone listed and no one selected. */
  home(): void
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

/** For any partner (spouse or co-parent); see FamilyStore.setMarriage. */
export function editMarriage(ctx: AppCtx, p: Person, spouse: Person) {
  const form = marriageForm(p.marriages[spouse.id] ?? emptyMarriage())
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
  if (rel === 'spouse') {
    const also = alsoParentOfBox(people, p)
    if (also) { extra = also.el; readOpts = also.read }
  }
  // The store makes the two parents a couple.
  if (rel === 'parent' && p.parents.length === 1) {
    const gender = people.get(p.parents[0])?.gender
    if (gender) initial.gender = gender === 'M' ? 'F' : 'M'
  }
  if (rel === 'child') {
    const select = h('select', {},
      ...partnersOf(people, p).map(s => h('option', { value: s.id }, displayName(s))),
      h('option', { value: '' }, t.otherParentNone),
    )
    extra = h('label', { class: 'field' }, h('span', { class: 'field-label' }, L('otherParent')), select)
    readOpts = () => ({ coParentId: select.value })
  }
  if (rel === 'sibling') {
    const select = h('select', {}, ...siblingParentChoices(people, p).map(c => h('option', { value: c.ids.join(',') }, c.label)))
    extra = h('label', { class: 'field' }, h('span', { class: 'field-label' }, L('parents')), select)
    readOpts = () => ({ parentIds: select.value.split(',') })
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

/**
 * "Also a parent of …" for children with only `p` as a parent, who are most likely a new spouse's
 * too; checked by default. Null when there are none.
 */
function alsoParentOfBox(people: People, p: Person) {
  const kids = childrenOf(people, p.id).filter(c => c.parents.length === 1)
  if (!kids.length) return null
  const box = h('input', { type: 'checkbox', checked: true })
  const el = h('label', { class: 'checkbox' }, box, `${t.alsoParentOf} ${kids.map(displayName).join(', ')}`)
  return { el, read: () => (box.checked ? { alsoParentOf: kids.map(c => c.id) } : {}) }
}

/**
 * Parent sets a new sibling of `p` can have: p's own parents (a full sibling, the default),
 * then each parent with one of their other partners, then each parent alone. Every choice but
 * the default makes a half sibling (see halfSiblingVia), via the parent of p's it includes.
 */
function siblingParentChoices(people: People, p: Person): { ids: string[]; label: string }[] {
  const choices: { ids: string[]; label: string }[] = []
  const seen = new Set<string>()
  const name = (id: string) => displayName(people.get(id))
  const half = (via: string) => ` (${halfTag(people.get(via))})`
  const add = (ids: string[], label: string) => {
    const key = [...ids].sort().join(',')
    if (seen.has(key)) return
    seen.add(key)
    choices.push({ ids, label })
  }
  add(p.parents, p.parents.map(name).join(' & '))
  for (const pid of p.parents) {
    const parent = people.get(pid)
    for (const sid of parent ? partnerIds(people, parent) : []) {
      if (!p.parents.includes(sid)) add([pid, sid], `${name(pid)} & ${name(sid)}${half(pid)}`)
    }
  }
  for (const pid of p.parents) add([pid], `${t.onlyParent} ${name(pid)}${half(pid)}`)
  return choices
}

export function linkExisting(ctx: AppCtx, p: Person) {
  const rel = h('select', {},
    h('option', { value: 'spouse' }, t.asSpouse),
    h('option', { value: 'parent' }, t.asParent),
    h('option', { value: 'child' }, t.asChild),
  )
  const picker = personPicker(() => ctx.store.people, () => {}, { exclude: p.id, selectable: true, idle: recentAndEveryone(() => ctx.store.people, { skip: () => p.id }) })
  // As in Add spouse; only offered while linking a spouse.
  const also = alsoParentOfBox(ctx.store.people, p)
  const syncAlso = () => { if (also) also.el.hidden = rel.value !== 'spouse' }
  rel.addEventListener('change', syncAlso)
  syncAlso()
  openDialog(L('linkExisting'),
    h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, L('linkAs')), rel), also?.el, picker.el),
    [
      {
        label: L('save'), primary: true, run: async () => {
          const other = picker.selected()
          if (!other) throw new Error(t.pickPerson)
          const r = rel.value as LinkRelative
          // store.link checks this too; checking first spares an editor-name prompt for a link that would fail.
          const problem = ctx.store.linkProblem(r, p.id, other.id)
          if (problem) throw new Error(problem)
          const editor = await ctx.editorName()
          if (!editor) return false
          await ctx.store.link(editor, r, p.id, other.id, r === 'spouse' && also ? also.read() : {})
        },
      },
    ], { subtitle: displayName(p), cls: 'tall' })
  picker.input.focus()
}

export async function deletePerson(ctx: AppCtx, p: Person) {
  if (!(await confirmDialog(`${t.confirmDelete} — ${displayName(p)}`, t.delete, true))) return
  const editor = await ctx.editorName()
  if (!editor) return
  // A parent or partner is the nearest place to land; with neither, the list of everyone.
  const next = p.parents[0] ?? partnerIds(ctx.store.people, p)[0]
  try {
    await ctx.store.deletePerson(editor, p.id)
  } catch (e) {
    toast(`${t.saveFailed}: ${(e as Error).message}`)
    return
  }
  if (next) ctx.select(next)
  else ctx.home()
}

/** Lists every relationship of `p` with a remove button. */
export function removeRelationship(ctx: AppCtx, p: Person) {
  const people = ctx.store.people
  const list = h('div', { class: 'form' })
  let close = () => {}
  const section = (label: string, rel: LinkRelative, others: Person[]) => others.length
    ? h('section', {}, h('h3', { class: 'section-title' }, label), h('div', { class: 'cards' }, ...others.map(other => {
      // Parents of a shared child stay a couple, so that Remove is disabled, saying why.
      const problem = ctx.store.unlinkProblem(rel, p.id, other.id)
      return personCard(other, null, h('button', {
        // Says whose relationship goes; the visible word comes first so voice control still finds it.
        // Stays focusable (aria-disabled, as in menus) and says why when pressed (in the dialog's error line), since a tooltip never shows on phones.
        type: 'button', class: 'danger small', 'aria-disabled': problem ? 'true' : undefined, title: problem ?? undefined,
        'aria-label': [`${t.remove} ${displayName(other)}`, problem].filter(Boolean).join(': '), onclick: async () => {
          if (problem) { toast(problem); return }
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
      }, t.remove))
    })))
    : null
  const get = (ids: string[]) => ids.map(id => people.get(id)).filter((x): x is Person => !!x)
  const sections = [
    section(t.parents, 'parent', get(p.parents)),
    section(t.spouses, 'spouse', partnersOf(people, p)),
    section(t.children, 'child', childrenOf(people, p.id)),
  ].filter((x): x is HTMLElement => !!x)
  list.append(...(sections.length ? sections : [h('p', { class: 'muted' }, t.noRelationships)]))
  close = openDialog(L('removeRelationship'), list, [], { subtitle: displayName(p) })
}

/** One row per parent, each with a relationship select that saves as soon as it changes. */
export function editParentKinds(ctx: AppCtx, p: Person) {
  const label: Record<ParentKind | '', string> = { '': t.birthParent, adoptive: t.adoptive }
  const rows = p.parents.map(id => ctx.store.people.get(id)).filter((x): x is Person => !!x).map(parent => {
    const current: ParentKind | '' = p.parentKinds[parent.id] ?? ''
    const select = h('select', { 'aria-label': `${t.parentKind}: ${displayName(parent)}` },
      ...(['', ...PARENT_KINDS] as (ParentKind | '')[]).map(k => h('option', { value: k, selected: k === current }, label[k])))
    let saved: ParentKind | '' = current
    select.addEventListener('change', async () => {
      const kind = select.value as ParentKind | ''
      try {
        const editor = await ctx.editorName()
        if (!editor) throw new Error()
        await ctx.store.setParentKind(editor, p.id, parent.id, kind)
        saved = kind
      } catch (e) {
        select.value = saved
        if ((e as Error).message) toast(`${t.saveFailed}: ${(e as Error).message}`)
      }
    })
    return personCard(parent, null, select)
  })
  openDialog(L('editParentKinds'), h('div', { class: 'cards' }, ...rows), [], { subtitle: displayName(p) })
}
