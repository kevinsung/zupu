import { h } from './dom'
import { t } from './i18n'
import { openDialog, personPicker } from './dialog'
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

/**
 * Full-screen search on phones, a dialog on wide screens. With an empty query it lists
 * recently viewed people and the top ancestor of each family line.
 */
export function openSearch(people: () => People, select: (id: string) => void, currentId: string) {
  let close = () => {}
  const go = (p: Person) => { close(); select(p.id) }
  const idle = () => {
    const all = people()
    const recent = recentIds().filter(id => id !== currentId).map(id => all.get(id)).filter((p): p is Person => !!p)
    const lines = rootAncestors(all)
    return [
      recent.length ? h('section', {}, h('h3', { class: 'section-title' }, t.recent),
        h('div', { class: 'cards' }, ...recent.map(p => personCard(p, () => go(p))))) : null,
      lines.length ? h('section', {}, h('h3', { class: 'section-title' }, t.familyLines),
        h('div', { class: 'cards' }, ...lines.map(p => {
          const c = personCard(p, () => go(p))
          c.querySelector('.pcard-name')!.textContent = coupleLabel(all, p)
          return c
        }))) : null,
    ].filter((x): x is HTMLElement => !!x)
  }
  const picker = personPicker(people, go, { idle })
  close = openDialog(t.search, picker.el, [], undefined, 'search tall')
  picker.input.focus()
}
