import { h } from './dom'
import { type Key, type Pair, L, both, colon, fill, pair, prefixed } from './i18n'
import { icon } from './icons'
import { personCard } from './cards'
import { type AppCtx, addRelative, editMarriage, editPerson } from './actions'
import { type Distance, kinDistance } from './kinship'
import { type People, type Person, type PersonFields, displayName, partnerIds, rankPeople } from './model'

export type GapKind = 'gender' | 'name' | 'nameZh' | 'birthDate' | 'deathDate' | 'marriage' | 'parents' | 'otherParent'
/** Something unrecorded about `person` (or, for a marriage, about the couple of `person` and `partner`), and how likely the user is to know it. */
export interface Gap { kind: GapKind, person: Person, partner?: Person, cost: number }

/** How many steps of kinship distance each kind of gap is worth: gender is known to anyone who knows the person, parents are harder. */
const DIFFICULTY: Record<GapKind, number> = {
  gender: 0, name: 0, birthDate: 1, deathDate: 1, marriage: 1, nameZh: 1, parents: 2, otherParent: 2,
}
/** For gaps that tie on everything else (on one person, mostly). */
const KIND_ORDER: GapKind[] = ['gender', 'name', 'birthDate', 'deathDate', 'marriage', 'nameZh', 'parents', 'otherParent']

/**
 * Everything missing, most likely known first: cost = kinship steps from `meId` + the gap's
 * difficulty, lowest first (with no me, everyone is 0 steps away; anyone unreachable comes last).
 * Ties go to the closer person, then the one with fewer partner links (blood before in-laws), then
 * KIND_ORDER, then `rankPeople` order. A marriage gap is listed once per couple, on the closer partner.
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
      if (m?.married || m?.status === 'unmarried') continue
      // Each couple once: from the closer partner (the earlier in rank on a tie).
      const c = closer(p.id, qid)
      if (c > 0 || (c === 0 && order.get(p.id)! > order.get(qid)!)) continue
      add('marriage', p, q)
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

export const skipKey = (g: Gap) => [g.kind, g.person.id, g.partner?.id].filter(Boolean).join(':')

export function getSkipped(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

function setSkipped(keys: Set<string>) {
  if (keys.size) localStorage.setItem(SKIP_KEY, JSON.stringify([...keys]))
  else localStorage.removeItem(SKIP_KEY)
}

// ---------------------------------------------------------------------------------------------
// Page

const PAGE = 25

const LABEL: Record<Exclude<GapKind, 'marriage'>, Key> = {
  gender: 'gender', name: 'gapName', nameZh: 'nameZh', birthDate: 'birthDate', deathDate: 'deathDate', parents: 'parents', otherParent: 'otherParent',
}
const FOCUS: Partial<Record<GapKind, keyof PersonFields>> = {
  gender: 'gender', name: 'nameZh', nameZh: 'nameZh', birthDate: 'birthDate', deathDate: 'deathDate',
}

/** The chip's text as a pair, for accessible names. */
const gapPair = (g: Gap): Pair => g.kind === 'marriage' ? prefixed(pair('marriage'), displayName(g.partner)) : pair(LABEL[g.kind])
/** The chip's label: marriage carries the partner's name after it, shown once. */
const gapLabel = (g: Gap): Node => {
  if (g.kind !== 'marriage') return L(LABEL[g.kind])
  const frag = document.createDocumentFragment()
  frag.append(L('marriage'), colon, displayName(g.partner))
  return frag
}

/**
 * The 待補資料 page: what's missing from the tree, grouped by person, those the user most likely
 * knows first. Each gap is a chip that opens the matching dialog; ✕ hides it on this device.
 * `refresh` rebuilds from the current people.
 */
export function missingPage(people: () => People, ctx: AppCtx, askMe: () => void) {
  let shown = PAGE
  let showSkipped = false
  const heading = h('h1', { class: 'missing-title', tabindex: '-1', 'data-refocus-key': 'h1' }, L('missingTitle'))
  const body = h('div', { class: 'missing' })
  const el = h('div', { class: 'missing-page' }, heading, body)

  const keyed = (key: string) => [...el.querySelectorAll<HTMLElement>('[data-refocus-key]')].find(n => n.dataset.refocusKey === key)

  function act(g: Gap) {
    const p = g.person
    switch (g.kind) {
      case 'marriage': return editMarriage(ctx, p, g.partner!)
      case 'parents': case 'otherParent': return addRelative(ctx, p, 'parent')
      default: return editPerson(ctx, p, FOCUS[g.kind])
    }
  }

  function chip(g: Gap) {
    const key = `chip:${skipKey(g)}`
    const label = both(gapPair(g))
    const main = h('button', { type: 'button', class: 'chip', 'data-refocus-key': key, 'data-refocus': `${key} p:${g.person.id} h1`, onclick: () => act(g) }, gapLabel(g))
    const skip = h('button', {
      type: 'button', class: 'ghost gap-skip', 'aria-label': both(prefixed(pair('dontKnow'), gapPair(g))), title: both(prefixed(pair('dontKnow'), gapPair(g))),
      'data-refocus': `p:${g.person.id} h1`,
      onclick: () => { setSkipped(new Set([...getSkipped(), skipKey(g)])); refresh() },
    }, icon('close'))
    main.title = label
    return h('span', { class: 'gap' }, main, skip)
  }

  function personRow(p: Person, gaps: Gap[]) {
    const card = personCard(p, () => ctx.select(p.id))
    card.querySelector<HTMLElement>('.pcard-main')!.dataset.refocusKey = `p:${p.id}`
    return h('div', { class: 'missing-person' }, card, h('div', { class: 'gap-chips' }, ...gaps.map(chip)))
  }

  function skippedRow(g: Gap) {
    return h('div', { class: 'missing-skipped-row' },
      h('strong', {}, displayName(g.person)), h('span', {}, gapLabel(g)),
      h('button', {
        type: 'button', class: 'chip', 'data-refocus': 'toggle h1', onclick: () => { const s = getSkipped(); s.delete(skipKey(g)); setSkipped(s); refresh() },
        'aria-label': both(prefixed(pair('undoSkip'), gapPair(g))),
      }, L('undoSkip')))
  }

  function refresh() {
    const active = document.activeElement
    const had = active && el.contains(active) ? (active as HTMLElement).dataset.refocus?.split(' ') ?? [] : null
    const me = ctx.me()
    const skipped = getSkipped()
    const all = findGaps(people(), me)
    const gaps = all.filter(g => !skipped.has(skipKey(g)))
    const hidden = all.filter(g => skipped.has(skipKey(g)))
    if (!hidden.length) showSkipped = false

    const byPerson = new Map<string, Gap[]>()
    for (const g of gaps) (byPerson.get(g.person.id) ?? byPerson.set(g.person.id, []).get(g.person.id)!).push(g)
    const rows = [...byPerson.values()]

    const parts: (Node | null)[] = [
      // Who the order is for (— before anyone is chosen), with a way to choose or change it.
      h('p', { class: 'missing-me' }, h('span', {}, L('meLabel'), colon, me ? h('strong', {}, displayName(people().get(me))) : '—'),
        h('button', { type: 'button', class: 'chip', onclick: () => askMe() }, L(me ? 'change' : 'choose'))),
      // What 我是 does here.
      h('p', { class: 'missing-why' }, L('missingWhy')),
      ...(gaps.length ? rows.slice(0, shown).map(r => personRow(r[0].person, r)) : [h('p', { class: 'muted' }, L('missingNone'))]),
      rows.length > shown
        ? h('button', { type: 'button', class: 'chip missing-more', 'data-refocus-key': 'more', 'data-refocus': 'more h1', onclick: () => { shown += PAGE; refresh() } }, L('showMore')) : null,
      hidden.length
        ? h('button', { type: 'button', class: 'chip faint', 'data-refocus-key': 'toggle', 'data-refocus': 'toggle h1', onclick: () => { showSkipped = !showSkipped; refresh() } },
          showSkipped ? L('hideSkipped') : L(fill('showSkipped', { n: hidden.length }))) : null,
      ...(showSkipped ? hidden.map(skippedRow) : [])]
    body.replaceChildren(...parts.filter((n): n is Node => !!n))

    // A rebuild destroys the control that had focus (after a dialog saves, say): move to the
    // same chip or person's card, else the heading, so focus doesn't fall to <body>.
    if (had) {
      const target = had.map(keyed).find(Boolean)
      ;(target ?? heading).focus({ preventScroll: true })
    }
  }
  return { el, refresh }
}
