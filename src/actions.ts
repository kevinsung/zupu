import { h } from './dom'
import { type Key, L, both, colon, fill, list as listNames, noted, pair, pairName, prefixed, t } from './i18n'
import { UserError, errorText } from './errors'
import { confirmDialog, marriageForm, openDialog, personForm, personPicker, toast } from './dialog'
import { halfTag, otherNamesLine, personCard } from './cards'
import { icon } from './icons'
import { type ParentKind, PARENT_KINDS, type People, type Person, type PersonFields, childrenOf, datesDecide, displayName, emptyFields, emptyMarriage, partnerIds, partnersOf } from './model'
import { offlineSince } from './backend'
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
  /** Who the user is on this device ('' if unset, or if that person is gone). */
  me(): string
  /** Remembers who the user is ('' clears it) and redraws what shows kinship terms. */
  setMe(id: string): void
}

/** Every write flow starts with this: offline, the data is a read-only copy. True when it is safe to go on. */
export function canEdit(): boolean {
  if (offlineSince === null) return true
  toast(t.offlineNoEdit, { error: true })
  return false
}

/** `focus` names the field to put the cursor in (default: the Chinese name). */
export function editPerson(ctx: AppCtx, p: Person, focus?: keyof PersonFields) {
  if (!canEdit()) return
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
  form.focus(focus)
}

/**
 * For any partner (spouse or co-parent); see FamilyStore.setMarriage.
 * `focus` names the date to put the cursor in (default: the status).
 */
export function editMarriage(ctx: AppCtx, p: Person, spouse: Person, focus?: 'married' | 'divorced') {
  if (!canEdit()) return
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
  form.focus(focus)
}

const ADD_TITLES = { parent: 'addParent', spouse: 'addSpouse', child: 'addChild', sibling: 'addSibling' } as const satisfies Record<NewRelative, string>

export function addRelative(ctx: AppCtx, p: Person, rel: NewRelative) {
  if (!canEdit()) return
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
  const el = h('label', { class: 'checkbox' }, box, L('alsoParentOf'), colon, listNames(kids.map(displayName)))
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
      if (!p.parents.includes(sid)) add([pid, sid], both(noted(`${name(pid)} & ${name(sid)}`, halfTag(people.get(pid)))))
    }
  }
  for (const pid of p.parents) add([pid], both(noted(pairName('onlyParent', name(pid)), halfTag(people.get(pid)))))
  return choices
}

export function linkExisting(ctx: AppCtx, p: Person) {
  if (!canEdit()) return
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
          if (!other) throw new UserError(pair('pickPerson'))
          const r = rel.value as LinkRelative
          // store.link checks this too; checking first spares an editor-name prompt for a link that would fail.
          const problem = ctx.store.linkProblem(r, p.id, other.id)
          if (problem) throw new UserError(problem)
          const editor = await ctx.editorName()
          if (!editor) return false
          await ctx.store.link(editor, r, p.id, other.id, r === 'spouse' && also ? also.read() : {})
        },
      },
    ], { subtitle: displayName(p), cls: 'tall' })
  picker.input.focus()
}

export async function deletePerson(ctx: AppCtx, p: Person) {
  if (!canEdit()) return
  if (!(await confirmDialog(t.confirmDelete, L('delete'), true, displayName(p)))) return
  const editor = await ctx.editorName()
  if (!editor) return
  // A parent or partner is the nearest place to land; with neither, the list of everyone.
  const next = p.parents[0] ?? partnerIds(ctx.store.people, p)[0]
  try {
    await ctx.store.deletePerson(editor, p.id)
  } catch (e) {
    toast(errorText(e, pair('saveFailed')), { error: true })
    return
  }
  if (next) ctx.select(next)
  else ctx.home()
}

/** Lists every relationship of `p` with a remove button. */
export function removeRelationship(ctx: AppCtx, p: Person) {
  if (!canEdit()) return
  const people = ctx.store.people
  const list = h('div', { class: 'form' })
  let locked = false
  let close = () => {}
  const section = (label: Key, rel: LinkRelative, others: Person[]) => others.length
    ? h('section', {}, h('h3', { class: 'section-title' }, L(label)), h('div', { class: 'cards' }, ...others.map(other => {
      // Parents of a shared child stay a couple, so that Remove is disabled, saying why.
      const problem = ctx.store.unlinkProblem(rel, p.id, other.id)
      if (problem) locked = true
      // Its name, and when locked its tooltip too, says why: "Remove 倪桂珍: Partners who share children…".
      const removeLabel = fill('removeName', { name: displayName(other) })
      const name = both(problem ? prefixed(removeLabel, problem) : removeLabel)
      return personCard(other, null, h('button', {
        // Says whose relationship goes; the visible word comes first so voice control still finds it.
        // Stays focusable (aria-disabled, as in menus) and does nothing when pressed: the dialog's
        // hint and the row's tag say why up front, as in Reorder, since a tooltip never shows on phones.
        type: 'button', class: 'danger small', 'aria-disabled': problem ? 'true' : undefined, title: problem ? name : undefined,
        'aria-label': name, onclick: async () => {
          if (problem) return
          if (!(await confirmDialog(t.confirmUnlink, L('remove'), true, `${displayName(p)} — ${displayName(other)}`))) return
          const editor = await ctx.editorName()
          if (!editor) return
          try {
            await ctx.store.unlink(editor, rel, p.id, other.id)
            close()
          } catch (e) {
            toast(errorText(e, pair('saveFailed')), { error: true })
          }
        },
      }, L('remove')), problem ? t.sharesChildrenShort : '')
    })))
    : null
  const get = (ids: string[]) => ids.map(id => people.get(id)).filter((x): x is Person => !!x)
  const sections = [
    section('parents', 'parent', get(p.parents)),
    section('spouses', 'spouse', partnersOf(people, p)),
    section('children', 'child', childrenOf(people, p.id)),
  ].filter((x): x is HTMLElement => !!x)
  list.append(...(sections.length ? sections : [h('p', { class: 'muted' }, t.noRelationships)]))
  if (locked) list.prepend(h('p', { class: 'muted dlg-hint' }, t.sharesChildren))
  close = openDialog(L('removeRelationship'), list, [], { subtitle: displayName(p) })
}

/** One row per parent, each with a relationship select that saves as soon as it changes. */
export function editParentKinds(ctx: AppCtx, p: Person) {
  if (!canEdit()) return
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
        if (!editor) { select.value = saved; return }
        await ctx.store.setParentKind(editor, p.id, parent.id, kind)
        saved = kind
      } catch (e) {
        select.value = saved
        toast(errorText(e, pair('saveFailed')), { error: true })
      }
    })
    return personCard(parent, null, select)
  })
  openDialog(L('editParentKinds'), h('div', { class: 'cards' }, ...rows), [], { subtitle: displayName(p) })
}

/** True when at least one neighbouring pair in `list` (in birth order) is left to the order set by hand. */
export function canReorder(list: Person[]): boolean {
  return list.some((p, i) => i > 0 && !datesDecide(list[i - 1], p))
}

/**
 * Birth order of `list` (siblings, already in byBirth order) with up and down buttons per row. A
 * move swaps a person with their neighbour, so it's disabled where their birth dates already decide
 * the order. A hint says so up front and each row shows the full birth date, so a locked arrow
 * explains itself (screen readers get the reason in its name). Save is the only action.
 */
export function reorderPeople(ctx: AppCtx, list: Person[], subtitle: string) {
  if (!canEdit()) return
  const work = [...list]
  const cards = h('div', { class: 'cards' })
  // Which button to focus after a redraw: the moved person's button in the same direction.
  const render = (focus?: { id: string; dir: -1 | 1 }) => {
    cards.replaceChildren(...work.map((x, i) => {
      const btn = (dir: -1 | 1) => {
        const other = work[i + dir]
        // Past either end, or across someone their date puts on that side, there's nowhere to go.
        const problem = other && datesDecide(x, other) ? pair('datesSetOrder') : undefined
        const label = fill(dir < 0 ? 'moveUpName' : 'moveDownName', { name: displayName(x) })
        // An icon button, so its tooltip is its name, with the reason when its dates lock it.
        const name = both(problem ? prefixed(label, problem) : label)
        return h('button', {
          // aria-disabled rather than disabled, so it keeps focus when a move takes the person to an end.
          type: 'button', class: 'small', 'data-dir': String(dir), 'aria-disabled': problem || !other ? 'true' : undefined, title: name,
          'aria-label': name, onclick: () => {
            if (!other || problem) return
            ;[work[i], work[i + dir]] = [work[i + dir], work[i]]
            render({ id: x.id, dir })
          },
        }, icon(dir < 0 ? 'arrowUp' : 'arrowDown'))
      }
      // The full date rather than the cards' years, so '1950' beside '1950-05' shows why they can swap.
      const sub = [x.birthDate || t.birthDateUnknown, otherNamesLine(x)].filter(Boolean).join(' · ')
      return h('div', { class: `pcard g-${x.gender || 'U'}`, 'data-id': x.id },
        h('div', { class: 'pcard-main' }, h('span', { class: 'pcard-name' }, displayName(x)), h('span', { class: 'pcard-sub' }, sub)),
        h('div', { class: 'move-btns' }, btn(-1), btn(1)))
    }))
    if (focus) cards.querySelector<HTMLElement>(`[data-id="${focus.id}"] button[data-dir="${focus.dir}"]`)?.focus()
  }
  render()
  openDialog(L('reorderTitle'), h('div', { class: 'form' }, h('p', { class: 'muted dlg-hint' }, L('reorderHint')), cards), [
    {
      label: L('save'), primary: true, run: async () => {
        if (!canEdit()) return false
        const editor = await ctx.editorName()
        if (!editor) return false
        await ctx.store.reorder(editor, work.map(x => x.id))
      },
    },
  ], { subtitle, cls: 'tall' })
}
