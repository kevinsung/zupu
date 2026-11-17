import { h } from './dom'
import { t } from './i18n'
import { type Marriage, type Person, allNames, displayName, lifespan } from './model'

/** e.g. "結婚 / Married 1962 · 離婚 / Divorced 1975"; '' if nothing is recorded. */
export function marriageText(m: Marriage | undefined): string {
  if (!m) return ''
  return [m.married && `${t.married} ${m.married}`, m.divorced && `${t.divorced} ${m.divorced}`].filter(Boolean).join(' · ')
}

/** Secondary line for a person: their other names and years. */
export function personSubtitle(p: Person): string {
  return [allNames(p).filter(n => n !== displayName(p)).join(' · '), lifespan(p)].filter(Boolean).join(' · ')
}

/** A tappable row for one person; the colored edge shows gender. `extra` goes on the right (e.g. a remove button). */
export function personCard(p: Person, onclick: () => void, extra?: Node): HTMLElement {
  const sub = personSubtitle(p)
  const main = h('button', { type: 'button', class: 'pcard-main', onclick },
    h('span', { class: 'pcard-name' }, displayName(p)),
    sub ? h('span', { class: 'pcard-sub' }, sub) : null)
  return h('div', { class: `pcard g-${p.gender || 'U'}`, 'data-id': p.id }, main, extra ?? h('span', { class: 'pcard-chev', 'aria-hidden': 'true' }, '›'))
}
