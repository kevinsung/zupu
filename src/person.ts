import { coarsePointer, h } from './dom'
import { L, lang, t, tName, type Key } from './i18n'
import { actionSheet, copyText, sectionHead } from './dialog'
import { type IconName, icon } from './icons'
import { avatar, datesLine, genderWord, marriageText, parentKindTag, personCard, selfCard } from './cards'
import { kinTerm } from './kinship'
import { type AppCtx, addRelative, canReorder, deletePerson, editMarriage, editParentKinds, editPerson, linkExisting, removeRelationship, reorderPeople } from './actions'
import { type Person, allNames, byBirth, childrenByCoParent, displayName, formatPhone, halfSiblingVia, partnersOf, siblingsOf } from './model'

export interface PersonViewOpts {
  /** Shown in the "more" menu on phones, where the tree is a separate tab. */
  showInTree?: () => void
}

/**
 * One person's page, laid out like a family group: parents above, then the person,
 * then each partner with the children they had together, then siblings.
 * Adding relatives is always available but kept small: a "＋ Add" button in each section
 * header, plus a dashed slot only where a section is empty.
 */
export function renderPerson(cont: HTMLElement, ctx: AppCtx, id: string, opts: PersonViewOpts = {}) {
  const people = ctx.store.people
  const p = people.get(id)
  cont.replaceChildren()
  if (!p) return

  const get = (ids: string[]) => ids.map(x => people.get(x)).filter((x): x is Person => !!x)
  const card = (other: Person) => personCard(other, () => ctx.select(other.id))
  const addSlot = (key: Key, onclick: () => void) =>
    h('button', { type: 'button', class: 'add-slot', onclick }, icon('plus'), h('span', {}, L(key)))
  const addButton = (label: string, onclick: (e: Event) => void) =>
    h('button', { type: 'button', class: 'section-add', 'aria-label': label, title: label, onclick },
      icon('plus'), h('span', {}, L('add')))
  const reorderButton = (list: Person[], subtitle: string) => canReorder(list)
    ? h('button', { type: 'button', class: 'section-add', 'aria-label': t.reorderTitle, title: t.reorderTitle, onclick: () => reorderPeople(ctx, list, subtitle) },
      icon('arrowUpDown'), h('span', {}, L('reorder')))
    : null
  const section = (cls: string, head: HTMLElement, ...body: (Node | null)[]) =>
    h('section', { class: `pv-section ${cls}` }, head, ...body)

  // Parents
  const parents = get(p.parents)
  const parentsEl = section('pv-parents',
    sectionHead(L('parents'), parents.length === 1 ? addButton(t.addParent, () => addRelative(ctx, p, 'parent')) : undefined),
    parents.length
      ? h('div', { class: 'cards cols-2 compact' }, ...parents.map(x => personCard(x, () => ctx.select(x.id), undefined, parentKindTag(p.parentKinds[x.id], 'parent'))))
      : addSlot('addParent', () => addRelative(ctx, p, 'parent')))

  // The person
  const name = displayName(p)
  const otherNames = allNames(p).filter(n => n !== name).join(' · ')
  // Colors show gender everywhere else; here it's also a word, for those who can't tell them apart.
  const facts = [genderWord(p), datesLine(p)].filter(Boolean).join(' · ')
  const me = ctx.me()
  const isMe = me === p.id
  const kin = me ? kinTerm(people, me, p.id) : null
  const moreBtn = h('button', { type: 'button', class: 'more', 'aria-haspopup': 'menu', 'aria-label': t.more, title: t.more }, icon('more'))
  moreBtn.addEventListener('click', () => actionSheet(name, [
    { icon: 'person', label: L(isMe ? 'notMe' : 'thisIsMe'), run: () => ctx.setMe(isMe ? '' : p.id) },
    { icon: 'plus', label: L('addParent'), run: () => addRelative(ctx, p, 'parent'), disabled: p.parents.length >= 2 ? t.parentsFull : undefined },
    { icon: 'plus', label: L('addSpouse'), run: () => addRelative(ctx, p, 'spouse') },
    { icon: 'plus', label: L('addChild'), run: () => addRelative(ctx, p, 'child') },
    { icon: 'plus', label: L('addSibling'), run: () => addRelative(ctx, p, 'sibling'), disabled: p.parents.length === 0 ? t.siblingNeedsParent : undefined },
    { icon: 'link', label: L('linkExisting'), run: () => linkExisting(ctx, p) },
    { icon: 'unlink', label: L('removeRelationship'), run: () => removeRelationship(ctx, p) },
    { icon: 'edit', label: L('editParentKinds'), run: () => editParentKinds(ctx, p), disabled: p.parents.length === 0 ? t.noParents : undefined },
    { icon: 'history', label: L('personHistory'), run: () => ctx.showHistory(p.id) },
    opts.showInTree ? { icon: 'tree', label: L('showInTree'), run: opts.showInTree } : null,
    { icon: 'trash', label: L('delete'), run: () => deletePerson(ctx, p), danger: true },
  ], moreBtn))
  const share = () => {
    const url = location.href
    if (navigator.share && coarsePointer.matches) navigator.share({ title: `${name} — ${t.title}`, url }).catch(() => {})
    else copyText(url)
  }
  const hero = h('section', { class: `pv-hero g-${p.gender || 'U'}` },
    avatar(p, 'avatar-lg'),
    h('h1', { tabindex: '-1' }, name),
    p.pinyin ? h('p', { class: 'pv-pinyin', lang: 'zh-Latn-pinyin' }, p.pinyin) : null,
    otherNames ? h('p', { class: 'pv-names' }, otherNames) : null,
    // The term large, then the English and how the relation runs; each language mode shows only its own.
    kin ? h('p', { class: 'pv-kin' }, ...(kin === 'self' ? [L('meTag')]
      : lang === 'en' ? [
        h('strong', { lang: 'en', class: 'pv-kin-term' }, kin.en),
        kin.gloss ? h('span', { class: 'pv-kin-en', lang: 'en' }, kin.gloss) : null,
      ] : [
        h('strong', { lang: 'zh-Hant', class: 'pv-kin-term' }, kin.zh),
        lang === 'zh' ? null : h('span', { class: 'pv-kin-en', lang: 'en' }, kin.en + (kin.gloss ? ` · ${kin.gloss}` : '')),
      ])) : null,
    facts ? h('p', { class: 'pv-dates' }, facts) : null,
    h('div', { class: 'pv-actions' },
      h('button', { type: 'button', class: 'primary', onclick: () => editPerson(ctx, p) }, icon('edit'), h('span', {}, L('edit'))),
      h('button', { type: 'button', onclick: share }, icon('share'), h('span', {}, L('share'))),
      moreBtn))

  // Contact: each row has the value and quick actions.
  const action = (label: Key, name: IconName, attrs: { href?: string; onclick?: () => void; 'aria-label'?: string }) => attrs.href
    ? h('a', { class: 'chip', href: attrs.href }, icon(name), h('span', {}, L(label)))
    : h('button', { type: 'button', class: 'chip', onclick: attrs.onclick, 'aria-label': attrs['aria-label'] }, icon(name), h('span', {}, L(label)))
  // Several rows have a Copy button; each says what it copies ("Copy Email").
  const copy = (what: Key, value: string) => action('copy', 'copy', { onclick: () => copyText(value), 'aria-label': `${t.copy} ${t[what]}` })
  const contactRow = (label: Key, value: Node | string, ...actions: HTMLElement[]) =>
    h('div', { class: 'crow' },
      h('div', { class: 'crow-text' }, h('span', { class: 'crow-label' }, L(label)), h('span', { class: 'crow-value' }, value)),
      actions.length ? h('div', { class: 'crow-actions' }, ...actions) : null)
  const contactRows = [
    p.phone && contactRow('phone', h('a', { href: `tel:${p.phone}` }, formatPhone(p.phone)), action('text', 'message', { href: `sms:${p.phone}` })),
    p.email && contactRow('email', h('a', { href: `mailto:${p.email}` }, p.email), copy('email', p.email)),
    p.line && contactRow('line', p.line, copy('line', p.line)),
    p.signal && contactRow('signal', p.signal, copy('signal', p.signal)),
    p.address && contactRow('address', h('span', { class: 'address' }, p.address), copy('address', p.address)),
  ].filter(x => !!x)
  const contactEl = contactRows.length
    ? section('contact', sectionHead(L('contact')), h('div', { class: 'surface crows' }, ...contactRows))
    : null
  const notesEl = p.notes ? section('notes-wrap', sectionHead(L('notes')), h('p', { class: 'surface notes' }, p.notes)) : null

  // Partners (spouses and co-parents) in marriage order, each with their marriage status and the
  // children they had together. Children whose other parent isn't recorded get their own group.
  const childGroups = childrenByCoParent(people, p.id)
  const partners = partnersOf(people, p).map(s => s.id)
  const coParents = [...partners, ...[...childGroups.keys()].filter(cp => !partners.includes(cp))]
  const marriageLine = (spouse: Person) => {
    const text = marriageText(p.marriages[spouse.id])
    const edit = () => editMarriage(ctx, p, spouse)
    return text
      ? h('div', { class: 'marriage' }, h('span', {}, text),
        h('button', { type: 'button', class: 'chip', onclick: edit, 'aria-label': t.editMarriage, title: t.editMarriage }, icon('edit')))
      : h('div', { class: 'marriage' }, h('button', { type: 'button', class: 'chip faint', onclick: edit }, icon('plus'), h('span', {}, L('addMarriage'))))
  }
  const families = coParents.map(cpId => {
    const cp = people.get(cpId)
    const kids = childGroups.get(cpId) ?? []
    return h('div', { class: 'family surface' },
      cp ? card(cp) : h('div', { class: 'family-unknown muted' }, t.unknownOtherParent),
      cp ? marriageLine(cp) : null,
      kids.length ? h('div', { class: 'family-kids' },
        h('div', { class: 'family-kids-head' }, h('div', { class: 'family-kids-label' }, L('children')),
          reorderButton(kids, `${displayName(p)}${cp ? ` & ${displayName(cp)}` : ''}`)),
        h('div', { class: 'cards cols-2' }, ...kids.map(kid => personCard(kid, () => ctx.select(kid.id), undefined, parentKindTag(kid.parentKinds[p.id], 'child'))))) : null)
  })
  const familyAdd = addButton(t.addSpouseOrChild, e => actionSheet(t.addSpouseOrChild, [
    { icon: 'plus', label: L('addSpouse'), run: () => addRelative(ctx, p, 'spouse') },
    { icon: 'plus', label: L('addChild'), run: () => addRelative(ctx, p, 'child') },
  ], e.currentTarget as HTMLElement))
  const familiesEl = section('pv-families',
    sectionHead(L('spousesChildren'), families.length ? familyAdd : undefined),
    ...families,
    families.length ? null : h('div', { class: 'add-row' },
      addSlot('addSpouse', () => addRelative(ctx, p, 'spouse')),
      addSlot('addChild', () => addRelative(ctx, p, 'child'))))

  // Full siblings in birth order with this person among them, then a section per kind of half sibling
  // (same father, same mother, then via a parent whose gender isn't recorded).
  const full: Person[] = []
  const halves = new Map<string, { cls: string; title: Node; kids: Person[] }>()
  for (const s of siblingsOf(people, p.id)) {
    const via = halfSiblingVia(p, s)
    if (!via) { full.push(s); continue }
    const parent = people.get(via)
    const g = parent?.gender
    const key = g || via
    if (!halves.has(key)) {
      halves.set(key, g === 'M' ? { cls: 'pv-half-paternal', title: L('halfSiblingsPaternal'), kids: [] }
        : g === 'F' ? { cls: 'pv-half-maternal', title: L('halfSiblingsMaternal'), kids: [] }
        : { cls: 'pv-half-via', title: document.createTextNode(tName('halfVia', displayName(parent))), kids: [] })
    }
    halves.get(key)!.kids.push(s)
  }
  const rank = (key: string) => (key === 'M' ? 0 : key === 'F' ? 1 : 2)
  const halfGroups = [...halves.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([, v]) => v)
  // Siblings come through parents, so with none recorded there's just a note saying so, shaped like the add slots.
  // The header's "＋ Add" goes on the first sibling section shown.
  const addSibling = () => addButton(t.addSibling, () => addRelative(ctx, p, 'sibling'))
  const siblingEls: HTMLElement[] = []
  if (!p.parents.length) {
    siblingEls.push(section('pv-siblings', sectionHead(L('siblings')), h('p', { class: 'slot-note' }, h('span', {}, L('siblingNeedsParent')))))
  } else if (!full.length && !halfGroups.length) {
    siblingEls.push(section('pv-siblings', sectionHead(L('siblings')), addSlot('addSibling', () => addRelative(ctx, p, 'sibling'))))
  } else {
    if (full.length) {
      const group = [...full, p].sort(byBirth)
      siblingEls.push(section('pv-siblings', sectionHead(L(halfGroups.length ? 'fullSiblings' : 'siblings'), reorderButton(group, name), addSibling()),
        h('div', { class: 'cards cols-2' }, ...group.map(s => (s === p ? selfCard(p) : card(s))))))
    }
    for (const g of halfGroups) {
      siblingEls.push(section(g.cls, sectionHead(g.title, reorderButton(g.kids, name), siblingEls.length ? undefined : addSibling()),
        h('div', { class: 'cards cols-2' }, ...g.kids.map(card))))
    }
  }

  cont.append(h('div', { class: 'pv' }, parentsEl, hero, contactEl, notesEl, familiesEl, ...siblingEls))
}
