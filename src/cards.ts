import { h } from './dom'
import { t, tn } from './i18n'
import { type Marriage, type Person, UNKNOWN, age, allNames, displayName, lifespan } from './model'

/** e.g. "結婚 / Married 1962 · 離婚 / Divorced 1975"; '' if nothing is recorded. */
export function marriageText(m: Marriage | undefined): string {
  if (!m) return ''
  return [m.married && `${t.married} ${m.married}`, m.divorced && `${t.divorced} ${m.divorced}`].filter(Boolean).join(' · ')
}

/** Secondary line for a person: their other names and years. */
export function personSubtitle(p: Person): string {
  return [allNames(p).filter(n => n !== displayName(p)).join(' · '), lifespan(p)].filter(Boolean).join(' · ')
}

/** e.g. "1985-03-14 · 41歲 / age 41" or "1920 – 1990-07 · 享年約70 / aged about 70"; '' if no dates. */
export function datesLine(p: Person): string {
  const dates = p.deathDate ? `${p.birthDate || '?'} – ${p.deathDate}` : p.birthDate
  const a = age(p)
  const ageText = a && tn(a.atDeath ? (a.approx ? 'agedAtDeathApprox' : 'agedAtDeath') : (a.approx ? 'ageApprox' : 'age'), a.years)
  return [dates, ageText].filter(Boolean).join(' · ')
}

/** A circle with the first character of the name, tinted by gender. */
export function avatar(p: Person, cls = ''): HTMLElement {
  const name = displayName(p)
  const initial = name === UNKNOWN ? '?' : [...name][0].toUpperCase()
  return h('span', { class: `avatar g-${p.gender || 'U'} ${cls}`.trim(), 'aria-hidden': 'true' }, initial)
}

/** How a half sibling is related, from the one parent they share: "同父異母 / Half · same father" etc. */
export function halfTag(parent: Person | undefined): string {
  return parent?.gender === 'M' ? t.halfPaternal : parent?.gender === 'F' ? t.halfMaternal : `${t.halfVia} ${displayName(parent)}`
}

/** A tappable row for one person; the colored edge shows gender. `extra` goes on the right (e.g. a remove button). */
export function personCard(p: Person, onclick: () => void, extra?: Node): HTMLElement {
  const sub = personSubtitle(p)
  const main = h('button', { type: 'button', class: 'pcard-main', onclick },
    h('span', { class: 'pcard-name' }, displayName(p)),
    sub ? h('span', { class: 'pcard-sub' }, sub) : null)
  return h('div', { class: `pcard g-${p.gender || 'U'}`, 'data-id': p.id }, main, extra ?? h('span', { class: 'pcard-chev', 'aria-hidden': 'true' }, '›'))
}

/** The current person shown among their siblings: same shape as a card, but not a link. */
export function selfCard(p: Person): HTMLElement {
  return h('div', { class: `pcard self g-${p.gender || 'U'}`, 'aria-current': 'page' },
    h('div', { class: 'pcard-main' },
      h('span', { class: 'pcard-name' }, displayName(p)),
      h('span', { class: 'pcard-sub' }, [t.self, lifespan(p)].filter(Boolean).join(' · '))))
}
