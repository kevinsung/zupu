import { h } from './dom'
import { type Key, type Pair, L, both, colon, fill, pair, prefixed } from './i18n'
import { icon } from './icons'
import { personCard } from './cards'
import { type AppCtx, addRelative, canEdit, editMarriage, editPerson, linkExisting } from './actions'
import { errorText } from './errors'
import { focusRefocusTarget, menuList, openMenu, toast } from './dialog'
import { type Gap, type GapKind, findGaps, getSkipped, pruneSkipped, setSkipped, skipKey } from './gaps'
import { type People, type Person, type PersonFields, displayName, partnerIds } from './model'

// ---------------------------------------------------------------------------------------------
// Page


const LABEL: Record<GapKind, Key> = {
  gender: 'gender', name: 'gapName', nameZh: 'nameZh', birthDate: 'birthDate', deathDate: 'deathDate',
  marriage: 'marriage', marriedDate: 'marriedDate', divorcedDate: 'divorcedDate', parents: 'parents', otherParent: 'otherParent',
}
const FOCUS: Partial<Record<GapKind, keyof PersonFields>> = {
  gender: 'gender', name: 'nameZh', nameZh: 'nameZh', birthDate: 'birthDate', deathDate: 'deathDate',
}

/** The chip's text as a pair, for accessible names. */
const gapPair = (g: Gap): Pair => g.partner ? prefixed(pair(LABEL[g.kind]), displayName(g.partner)) : pair(LABEL[g.kind])
/** A label with a name after it, shown once (see the 中英 rule in i18n.ts). */
const named = (key: Key, name: string): Node => {
  const frag = document.createDocumentFragment()
  frag.append(L(key), colon, name)
  return frag
}
/** The chip's label: a couple's gap carries the partner's name after it. */
const gapLabel = (g: Gap): Node => (g.partner ? named(LABEL[g.kind], displayName(g.partner)) : L(LABEL[g.kind]))

/**
 * The 待補資料 page: what's missing from the tree, grouped by person, those the user most likely
 * knows first. Each gap is a chip that opens the matching dialog; ✕ hides it on this device.
 * `refresh` rebuilds from the current people.
 */
export function missingPage(people: () => People, ctx: AppCtx, askMe: () => void) {
  let showSkipped = false
  const heading = h('h1', { class: 'missing-title', tabindex: '-1', 'data-refocus-key': 'missing:h1' }, L('missingTitle'))
  const body = h('div', { class: 'missing' })
  const el = h('div', { class: 'missing-page' }, heading, body)

  /**
   * Adding a parent always makes a new person, so first offer who's likely already in the tree: the
   * existing parent's other partners (for the missing second parent), or anyone, by search.
   */
  function parentMenu(g: Gap, anchor: HTMLElement) {
    const p = g.person
    const known = g.kind === 'otherParent' ? p.parents.map(id => people().get(id)).find(Boolean) : undefined
    const partners = known ? partnerIds(people(), known).map(id => people().get(id)!)
      .filter(q => !p.parents.includes(q.id) && !ctx.store.linkProblem('parent', p.id, q.id)) : []
    let close = () => {}
    const items = [
      ...partners.map(q => ({ icon: 'link' as const, label: named('linkAsParent', displayName(q)), run: () => linkParent(p, q) })),
      { icon: 'search' as const, label: L('linkExisting'), run: () => linkExisting(ctx, p, 'parent') },
      { icon: 'plus' as const, label: L('addParent'), run: () => addRelative(ctx, p, 'parent') },
    ]
    close = openMenu(both(gapPair(g)), menuList(items, () => close()), anchor)
  }

  async function linkParent(p: Person, parent: Person) {
    if (!canEdit()) return
    const editor = await ctx.editorName()
    if (!editor) return
    try {
      await ctx.store.link(editor, 'parent', p.id, parent.id)
    } catch (e) {
      toast(errorText(e, pair('saveFailed')), { error: true })
    }
  }

  function act(g: Gap, anchor: HTMLElement) {
    const p = g.person
    switch (g.kind) {
      case 'marriage': return editMarriage(ctx, p, g.partner!)
      case 'marriedDate': return editMarriage(ctx, p, g.partner!, 'married')
      case 'divorcedDate': return editMarriage(ctx, p, g.partner!, 'divorced')
      case 'parents': case 'otherParent': return parentMenu(g, anchor)
      default: return editPerson(ctx, p, FOCUS[g.kind])
    }
  }

  function chip(g: Gap) {
    const key = `missing:chip:${skipKey(g)}`
    const label = both(gapPair(g))
    const main = h('button', { type: 'button', class: 'chip', 'data-refocus-key': key, 'data-refocus': `${key} missing:p:${g.person.id} missing:h1`, onclick: e => act(g, e.currentTarget as HTMLElement) }, gapLabel(g))
    const skip = h('button', {
      type: 'button', class: 'ghost gap-skip', 'aria-label': both(prefixed(pair('dontKnow'), gapPair(g))), title: both(prefixed(pair('dontKnow'), gapPair(g))),
      'data-refocus': `missing:p:${g.person.id} missing:h1`,
      onclick: () => { setSkipped(new Set([...getSkipped(), skipKey(g)])); refresh() },
    }, icon('close'))
    main.title = label
    return h('span', { class: 'gap' }, main, skip)
  }

  function personRow(p: Person, gaps: Gap[]) {
    const card = personCard(p, () => ctx.select(p.id))
    card.querySelector<HTMLElement>('.pcard-main')!.dataset.refocusKey = `missing:p:${p.id}`
    return h('div', { class: 'missing-person' }, card, h('div', { class: 'gap-chips' }, ...gaps.map(chip)))
  }

  function skippedRow(g: Gap) {
    return h('div', { class: 'missing-skipped-row' },
      h('strong', {}, displayName(g.person)), h('span', {}, gapLabel(g)),
      h('button', {
        type: 'button', class: 'chip', 'data-refocus': 'missing:toggle missing:h1', onclick: () => { const s = getSkipped(); s.delete(skipKey(g)); setSkipped(s); refresh() },
        'aria-label': both(prefixed(pair('undoSkip'), gapPair(g))),
      }, L('undoSkip')))
  }

  function refresh() {
    const active = document.activeElement
    const had = active && el.contains(active) ? (active as HTMLElement).dataset.refocus?.split(' ') ?? [] : null
    const me = ctx.me()
    const all = findGaps(people(), me)
    let skipped = getSkipped()
    // Keys of gaps since filled in would pile up; but not on a tree that hasn't loaded.
    if (people().size > 0) {
      const live = pruneSkipped(skipped, all)
      if (live.size !== skipped.size) setSkipped(skipped = live)
    }
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
      // Skipped gaps, at the top so they're reachable without scrolling past the whole list.
      hidden.length
        ? h('div', { class: 'missing-skipped' },
          h('button', { type: 'button', class: 'chip faint', 'aria-expanded': String(showSkipped), 'data-refocus-key': 'missing:toggle', 'data-refocus': 'missing:toggle missing:h1', onclick: () => { showSkipped = !showSkipped; refresh() } },
            showSkipped ? L('hideSkipped') : L(fill('showSkipped', { n: hidden.length }))),
          ...(showSkipped ? hidden.map(skippedRow) : []))
        : null,
      ...(gaps.length ? rows.map(r => personRow(r[0].person, r)) : [h('p', { class: 'muted' }, L('missingNone'))])]
    body.replaceChildren(...parts.filter((n): n is Node => !!n))

    // A rebuild destroys the control that had focus (after a dialog saves, say): move to the
    // same chip or person's card, else the heading, so focus doesn't fall to <body>.
    if (had && !focusRefocusTarget(had, el)) heading.focus({ preventScroll: true })
  }
  return { el, refresh }
}
