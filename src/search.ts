import { h } from './dom'
import { L, t } from './i18n'
import { closePopover, openDialog, personPicker } from './dialog'
import { personCard } from './cards'
import { type People, type Person, coupleLabel, rootAncestors } from './model'

const RECENT_KEY = 'ft-recent'
const RECENT_MAX = 8

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

/** With an empty query: recently viewed people and the top ancestor of each family line. */
function idleLists(people: () => People, currentId: () => string, go: (p: Person) => void) {
  return () => {
    const all = people()
    const recent = recentIds().filter(id => id !== currentId()).map(id => all.get(id)).filter((p): p is Person => !!p)
    const lines = rootAncestors(all)
    return [
      recent.length ? h('section', {}, h('h3', { class: 'section-title' }, L('recent')),
        h('div', { class: 'cards' }, ...recent.map(p => personCard(p, () => go(p))))) : null,
      lines.length ? h('section', {}, h('h3', { class: 'section-title' }, L('familyLines')),
        h('div', { class: 'cards' }, ...lines.map(p => {
          const c = personCard(p, () => go(p))
          c.querySelector('.pcard-name')!.textContent = coupleLabel(all, p)
          return c
        }))) : null,
    ].filter((x): x is HTMLElement => !!x)
  }
}

/** Full-screen search for phones: the search box is the header, results fill the screen. */
export function openSearch(people: () => People, select: (id: string) => void, currentId: string) {
  let close = () => {}
  const go = (p: Person) => { close(); select(p.id) }
  const picker = personPicker(people, go, { idle: idleLists(people, () => currentId, go) })
  close = openDialog(t.search, picker.el, [], { cls: 'search tall', head: picker.input })
  picker.input.focus()
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
  const picker = personPicker(people, go, { input, idle: idleLists(people, currentId, go) })
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
