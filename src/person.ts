import { h } from './dom'
import { t } from './i18n'
import { actionSheet, toast } from './dialog'
import { personCard } from './cards'
import { type AppCtx, addRelative, deletePerson, editPerson, linkExisting, removeRelationship } from './actions'
import { type Person, allNames, childrenByCoParent, displayName, formatPhone, lifespan, siblingsOf } from './model'

export interface PersonViewOpts {
  /** Shown in the "more" menu on phones, where the tree is a separate tab. */
  showInTree?: () => void
}

/**
 * One person's page, laid out like a family group: parents above, then the person,
 * then each spouse with the children they had together, then siblings.
 */
export function renderPerson(cont: HTMLElement, ctx: AppCtx, id: string, opts: PersonViewOpts = {}) {
  const people = ctx.store.people
  const p = people.get(id)
  cont.replaceChildren()
  if (!p) return

  const get = (ids: string[]) => ids.map(x => people.get(x)).filter((x): x is Person => !!x)
  const card = (other: Person) => personCard(other, () => ctx.select(other.id))
  const addSlot = (label: string, onclick: () => void) =>
    h('button', { type: 'button', class: 'add-slot', onclick }, h('span', { 'aria-hidden': 'true' }, '＋'), ` ${label}`)
  const section = (cls: string, title: string, ...body: (Node | null)[]) =>
    h('section', { class: `pv-section ${cls}` }, h('h3', { class: 'section-title' }, title), ...body)

  // Parents
  const parents = get(p.parents)
  const parentsEl = section('pv-parents', t.parents,
    h('div', { class: 'cards cols-2' },
      ...parents.map(card),
      parents.length < 2 ? addSlot(t.addParent, () => addRelative(ctx, p, 'parent')) : null))

  // The person
  const name = displayName(p)
  const otherNames = allNames(p).filter(n => n !== name).join(' · ')
  const menu = () => actionSheet(name, [
    { icon: '＋', label: t.addParent, run: () => addRelative(ctx, p, 'parent'), disabled: p.parents.length >= 2 ? t.parentsFull : undefined },
    { icon: '＋', label: t.addSpouse, run: () => addRelative(ctx, p, 'spouse') },
    { icon: '＋', label: t.addChild, run: () => addRelative(ctx, p, 'child') },
    { icon: '＋', label: t.addSibling, run: () => addRelative(ctx, p, 'sibling'), disabled: p.parents.length === 0 ? t.siblingNeedsParent : undefined },
    { icon: '🔗', label: t.linkExisting, run: () => linkExisting(ctx, p) },
    { icon: '✂', label: t.removeRelationship, run: () => removeRelationship(ctx, p) },
    opts.showInTree ? { icon: '🌳', label: t.showInTree, run: opts.showInTree } : null,
    { icon: '🗑', label: t.delete, run: () => deletePerson(ctx, p), danger: true },
  ])
  const share = async () => {
    const url = location.href
    if (navigator.share && matchMedia?.('(pointer: coarse)').matches) {
      await navigator.share({ title: `${name} — ${t.title}`, url }).catch(() => {})
      return
    }
    await navigator.clipboard.writeText(url).then(() => toast(t.copied), () => toast(url))
  }
  const hero = h('section', { class: `pv-hero g-${p.gender || 'U'}` },
    h('h2', {}, name),
    otherNames ? h('p', { class: 'pv-names' }, otherNames) : null,
    lifespan(p) ? h('p', { class: 'pv-years' }, lifespan(p)) : null,
    h('div', { class: 'pv-actions' },
      h('button', { type: 'button', class: 'primary', onclick: () => editPerson(ctx, p) }, `✎ ${t.edit}`),
      h('button', { type: 'button', onclick: share }, t.share),
      h('button', { type: 'button', class: 'more', onclick: menu, 'aria-haspopup': 'dialog', 'aria-label': t.more, title: t.more }, '⋯')))

  // Details: only fields that have values, minus the name already in the title.
  const facts: [string, string | Node | false][] = [
    [t.nameZh, p.nameZh !== name && p.nameZh], [t.nameEn, p.nameEn !== name && p.nameEn], [t.otherNames, p.otherNames !== name && p.otherNames],
    [t.gender, p.gender === 'M' ? t.male : p.gender === 'F' ? t.female : ''],
    [t.birthDate, p.birthDate], [t.deathDate, p.deathDate],
  ]
  const contact: [string, string | Node][] = [
    [t.email, p.email && h('a', { href: `mailto:${p.email}` }, p.email)],
    [t.phone, p.phone && h('a', { href: `tel:${p.phone}` }, formatPhone(p.phone))],
    [t.address, p.address && h('span', { class: 'address' }, p.address)],
    [t.line, p.line], [t.signal, p.signal], [t.whatsapp, p.whatsapp],
  ]
  const factList = (items: [string, string | Node | false][]) =>
    h('dl', { class: 'facts' }, ...items.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v as string | Node)]))
  const details = h('section', { class: 'pv-section pv-details' },
    factList(facts),
    contact.some(([, v]) => v) ? h('div', { class: 'contact' }, h('h3', { class: 'section-title' }, t.contact), factList(contact)) : null,
    p.notes ? h('div', { class: 'notes-wrap' }, h('h3', { class: 'section-title' }, t.notes), h('p', { class: 'notes' }, p.notes)) : null)

  // Spouses, each with the children they had together. Children whose other parent isn't a
  // spouse (or isn't recorded) get their own group.
  const childGroups = childrenByCoParent(people, p.id)
  const spouses = get(p.spouses)
  const coParents = [...spouses.map(s => s.id), ...[...childGroups.keys()].filter(cp => !p.spouses.includes(cp))]
  const families = coParents.map(cpId => {
    const cp = people.get(cpId)
    const kids = childGroups.get(cpId) ?? []
    return h('div', { class: 'family' },
      cp ? card(cp) : h('div', { class: 'family-unknown muted' }, t.unknownOtherParent),
      kids.length ? h('div', { class: 'family-kids' },
        h('div', { class: 'family-kids-label' }, t.childrenWith),
        h('div', { class: 'cards cols-2' }, ...kids.map(card))) : null)
  })
  const familiesEl = section('pv-families', t.spousesChildren,
    ...families,
    h('div', { class: 'add-row' },
      addSlot(t.addSpouse, () => addRelative(ctx, p, 'spouse')),
      addSlot(t.addChild, () => addRelative(ctx, p, 'child'))))

  // Siblings
  const siblings = siblingsOf(people, p.id)
  const siblingsEl = section('pv-siblings', t.siblings,
    siblings.length ? h('div', { class: 'cards cols-2' }, ...siblings.map(card)) : null,
    p.parents.length ? addSlot(t.addSibling, () => addRelative(ctx, p, 'sibling')) : siblings.length ? null : h('p', { class: 'muted small' }, t.none))

  cont.append(h('div', { class: 'pv' }, parentsEl, hero, details, familiesEl, siblingsEl))
}
