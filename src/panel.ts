import { h } from './dom'
import { t } from './i18n'
import { confirmDialog, openDialog, personForm, personPicker } from './dialog'
import {
  type Person, type PersonFields, allNames, childrenByCoParent, displayName, emptyFields, lifespan, siblingsOf,
} from './model'
import type { FamilyStore, LinkRelative, NewRelative } from './store'

export interface AppCtx {
  store: FamilyStore
  select(id: string): void
  /** Resolves to the editor's name, prompting for it the first time; null if they cancel. */
  editorName(): Promise<string | null>
}

export function renderPanel(cont: HTMLElement, ctx: AppCtx, id: string) {
  const people = ctx.store.people
  const p = people.get(id)
  cont.replaceChildren()
  if (!p) return

  const chip = (other: Person, unlinkRel?: LinkRelative) => h('span', { class: 'chip' },
    h('button', { type: 'button', class: 'link', onclick: () => ctx.select(other.id) }, displayName(other)),
    unlinkRel ? h('button', {
      type: 'button', class: 'chip-x', title: t.unlink, 'aria-label': t.unlink,
      onclick: async () => {
        if (!(await confirmDialog(`${t.confirmUnlink} ${displayName(p)} — ${displayName(other)}`, t.unlink, true))) return
        const editor = await ctx.editorName()
        if (editor) await ctx.store.unlink(editor, unlinkRel, p.id, other.id).catch(e => alert(e.message))
      },
    }, '✕') : null,
  )
  const relRow = (label: string, items: Node[]) =>
    h('div', { class: 'rel' }, h('h3', {}, label), items.length ? h('div', { class: 'chips' }, ...items) : h('span', { class: 'muted' }, t.none))

  const parents = p.parents.map(pid => people.get(pid)).filter((x): x is Person => !!x)
  const spouses = p.spouses.map(sid => people.get(sid)).filter((x): x is Person => !!x)
  const childGroups = [...childrenByCoParent(people, p.id)]

  const childrenEls = childGroups.map(([coParent, kids]) => h('div', { class: 'child-group' },
    childGroups.length > 1 || coParent
      ? h('div', { class: 'muted small' }, coParent ? `${t.with} ${displayName(people.get(coParent))}` : t.unknownOtherParent)
      : null,
    h('div', { class: 'chips' }, ...kids.map(k => chip(k, 'child'))),
  ))

  const facts: [string, string][] = [
    [t.nameZh, p.nameZh], [t.nameEn, p.nameEn], [t.otherNames, p.otherNames],
    [t.gender, p.gender === 'M' ? t.male : p.gender === 'F' ? t.female : ''],
    [t.birthDate, p.birthDate], [t.deathDate, p.deathDate],
  ]
  const contact: [string, string | Node][] = [
    [t.email, p.email && h('a', { href: `mailto:${p.email}` }, p.email)],
    [t.phone, p.phone && h('a', { href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, p.phone)],
    [t.address, p.address && h('span', { class: 'address' }, p.address)],
    [t.line, p.line], [t.signal, p.signal], [t.whatsapp, p.whatsapp],
  ]
  const factList = (items: [string, string | Node][]) =>
    h('dl', { class: 'facts' }, ...items.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))

  const btn = (label: string, onclick: () => void, opts: { disabled?: string; cls?: string } = {}) =>
    h('button', { type: 'button', class: opts.cls, disabled: !!opts.disabled, title: opts.disabled, onclick }, label)

  cont.append(
    h('div', { class: 'panel-head' },
      h('h2', {}, displayName(p)),
      h('div', { class: 'muted' }, [allNames(p).filter(n => n !== displayName(p)).join(' · '), lifespan(p)].filter(Boolean).join(' · ')),
    ),
    factList(facts),
    contact.some(([, v]) => v) ? h('div', { class: 'contact' }, h('h3', {}, t.contact), factList(contact)) : '',
    p.notes ? h('p', { class: 'notes' }, p.notes) : '',
    h('div', { class: 'actions' },
      btn(t.edit, () => editPerson(ctx, p), { cls: 'primary' }),
      btn(t.copyLink, async () => {
        await navigator.clipboard.writeText(location.href)
        alert(t.copied)
      }),
    ),
    relRow(t.parents, parents.map(x => chip(x, 'parent'))),
    relRow(t.spouses, spouses.map(x => chip(x, 'spouse'))),
    h('div', { class: 'rel' }, h('h3', {}, t.children), childrenEls.length ? h('div', {}, ...childrenEls) : h('span', { class: 'muted' }, t.none)),
    relRow(t.siblings, siblingsOf(people, p.id).map(x => chip(x))),
    h('div', { class: 'actions add' },
      btn(`＋ ${t.addParent}`, () => addRelative(ctx, p, 'parent'), { disabled: p.parents.length >= 2 ? t.parentsFull : undefined }),
      btn(`＋ ${t.addSpouse}`, () => addRelative(ctx, p, 'spouse')),
      btn(`＋ ${t.addChild}`, () => addRelative(ctx, p, 'child')),
      btn(`＋ ${t.addSibling}`, () => addRelative(ctx, p, 'sibling'), { disabled: p.parents.length === 0 ? t.siblingNeedsParent : undefined }),
      btn(`🔗 ${t.linkExisting}`, () => linkExisting(ctx, p)),
    ),
    h('div', { class: 'actions' }, btn(t.delete, () => deletePerson(ctx, p), { cls: 'danger' })),
  )
}

function editPerson(ctx: AppCtx, p: Person) {
  const form = personForm(p)
  openDialog(`${t.edit}: ${displayName(p)}`, form.el, [
    { label: t.cancel },
    {
      label: t.save, primary: true, run: async () => {
        const fields = form.read()
        const editor = await ctx.editorName()
        if (!editor) return false
        await ctx.store.updateFields(editor, p.id, fields)
      },
    },
  ])
  form.focus()
}

const ADD_TITLES: Record<NewRelative, string> = {
  parent: t.addParent, spouse: t.addSpouse, child: t.addChild, sibling: t.addSibling,
}

function addRelative(ctx: AppCtx, p: Person, rel: NewRelative) {
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
    extra = h('label', { class: 'field' }, h('span', {}, t.otherParent), select)
    readOpts = () => ({ coParentId: select.value })
  }

  const form = personForm(initial)
  openDialog(`${ADD_TITLES[rel]} → ${displayName(p)}`, h('div', {}, extra, form.el), [
    { label: t.cancel },
    {
      label: t.save, primary: true, run: async () => {
        const fields = form.read()
        const editor = await ctx.editorName()
        if (!editor) return false
        await ctx.store.addRelative(editor, rel, p.id, fields, readOpts())
      },
    },
  ])
  form.focus()
}

function linkExisting(ctx: AppCtx, p: Person) {
  const rel = h('select', {},
    h('option', { value: 'spouse' }, t.asSpouse),
    h('option', { value: 'parent' }, t.asParent),
    h('option', { value: 'child' }, t.asChild),
  )
  const status = h('p', { class: 'dlg-error' })
  let close = () => {}
  const picker = personPicker(() => ctx.store.people, async other => {
    const r = rel.value as LinkRelative
    const problem = ctx.store.linkProblem(r, p.id, other.id)
    if (problem) { status.textContent = problem; return }
    const editor = await ctx.editorName()
    if (!editor) return
    try {
      await ctx.store.link(editor, r, p.id, other.id)
      close()
    } catch (e) {
      status.textContent = `${t.saveFailed}: ${(e as Error).message}`
    }
  }, { exclude: p.id })
  close = openDialog(`${t.linkExisting} → ${displayName(p)}`,
    h('div', { class: 'form' }, picker.el, h('label', { class: 'field' }, h('span', {}, t.linkAs), rel), status),
    [{ label: t.close }])
  picker.input.focus()
}

async function deletePerson(ctx: AppCtx, p: Person) {
  if (!(await confirmDialog(`${t.confirmDelete} — ${displayName(p)}`, t.delete, true))) return
  const editor = await ctx.editorName()
  if (!editor) return
  const next = p.parents[0] ?? p.spouses[0] ?? [...ctx.store.people.keys()].find(id => id !== p.id)
  await ctx.store.deletePerson(editor, p.id).catch(e => alert(e.message))
  if (next) ctx.select(next)
}
