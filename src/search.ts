import { h } from './dom'
import { L, t, type Key } from './i18n'
import { closePopover, personPicker } from './dialog'
import { type People, type Person, displayName, rankPeople } from './model'
import { getMe, meChooser } from './me'

const RECENT_KEY = 'ft-recent'
const RECENT_MAX = 5

export function rememberRecent(id: string) {
  const list = recentIds().filter(x => x !== id)
  localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...list].slice(0, RECENT_MAX)))
}

function recentIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Recently viewed people, newest first, skipping any since deleted. */
function recentPeople(all: People): Person[] {
  return recentIds().map(id => all.get(id)).filter((p): p is Person => !!p).slice(0, RECENT_MAX)
}

/**
 * What a person search lists before anything is typed: you (once picked in the menu, so your own
 * page is a tap away), the people recently viewed, then everyone, most senior first (see
 * rankPeople). `skip` leaves one person out of all three.
 */
export function recentAndEveryone(people: () => People, opts: { skip?: () => string | undefined; heading?: 'h2' | 'h3' } = {}) {
  return (card: (p: Person) => HTMLElement) => {
    const all = people()
    const skip = opts.skip?.()
    const section = (title: Key, list: Person[]) => {
      const shown = list.filter(p => p.id !== skip)
      return shown.length
        ? h('section', {}, h(opts.heading ?? 'h3', { class: 'section-title' }, L(title)), h('div', { class: 'cards' }, ...shown.map(card)))
        : null
    }
    const me = all.get(getMe())
    return [
      section('meTag', me ? [me] : []),
      section('recent', recentPeople(all).filter(p => p !== me)),
      section('everyone', rankPeople(all)),
    ].filter((x): x is HTMLElement => !!x)
  }
}

/**
 * The landing page: everyone, most senior first (see rankPeople), filtered as you type with no
 * limit. While the box is empty, the people recently viewed come first. The box stays put and
 * the list scrolls under it.
 */
export function homeList(people: () => People, select: (id: string) => void, askMe: () => void) {
  const picker = personPicker(people, p => select(p.id), { idle: recentAndEveryone(people, { heading: 'h2' }) })
  picker.input.classList.add('home-filter')
  // Who you are, which decides what each person is called in the list.
  const chooser = meChooser('meHint', askMe)
  const scroller = h('div', { class: 'home-list' }, chooser.el, picker.list)

  /** Rebuilds the list (after an edit, here or elsewhere), keeping the filter and the focused person. */
  function refresh() {
    const active = document.activeElement
    const focusedId = active && picker.list.contains(active) ? active.closest<HTMLElement>('.pcard')?.dataset.id : undefined
    const me = people().get(getMe())
    chooser.update(me ? displayName(me) : undefined)
    picker.refresh()
    if (!focusedId) return
    const card = [...picker.list.querySelectorAll<HTMLElement>('.pcard')].find(c => c.dataset.id === focusedId)
    card?.querySelector<HTMLElement>('.pcard-main')?.focus({ preventScroll: true })
  }
  picker.input.setAttribute('aria-keyshortcuts', '/')
  const head = h('div', { class: 'home-head' }, picker.input)
  return {
    el: h('div', { class: 'home' }, h('h1', { class: 'sr-only', tabindex: '-1' }, L('title')), head, scroller, picker.live),
    /** The filter, and its place over the list; wide screens move it into the top bar. */
    input: picker.input,
    head,
    refresh,
    focus: () => picker.input.focus(),
  }
}

/**
 * The top-bar search on wide screens: a box whose results drop down under it. Focus or `/`
 * opens the list; arrow keys and Enter pick; Esc or a click elsewhere closes it.
 * It's a plain search box, not an ARIA combobox: the results are ordinary buttons reached
 * with the arrow keys or Tab, and the number of matches is announced as you type.
 */
export function searchBox(people: () => People, select: (id: string) => void, currentId: () => string) {
  const input = h('input', {
    type: 'search', class: 'search-trigger', placeholder: t.search, 'aria-label': t.search,
    autocomplete: 'off', 'aria-controls': 'search-pop', 'aria-keyshortcuts': '/',
  })
  const pop = h('div', { class: 'search-pop', id: 'search-pop', hidden: true })
  const wrap = h('div', { class: 'search-box' }, input, h('kbd', { 'aria-hidden': 'true' }, '/'), pop)
  const go = (p: Person) => { hide(); input.blur(); select(p.id) }
  const picker = personPicker(people, go, { input, idle: recentAndEveryone(people, { skip: currentId }) })
  pop.append(picker.list)
  // Outside the drop-down, which is hidden at times.
  wrap.append(picker.live)

  const show = () => {
    if (!pop.hidden) return
    closePopover()
    picker.refresh()
    pop.hidden = false
    document.addEventListener('pointerdown', onDown, true)
  }
  const hide = () => {
    pop.hidden = true
    document.removeEventListener('pointerdown', onDown, true)
  }
  const onDown = (e: Event) => { if (!wrap.contains(e.target as Node)) hide() }
  input.addEventListener('focus', show)
  input.addEventListener('click', show)
  input.addEventListener('input', show)
  wrap.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    if (input.value) { input.value = ''; picker.refresh(); input.focus() } else { hide(); input.blur() }
  })
  wrap.addEventListener('focusout', e => {
    const next = (e as FocusEvent).relatedTarget as Node | null
    if (next && !wrap.contains(next)) hide()
  })
  return { el: wrap, focus: () => { input.focus(); show() } }
}
