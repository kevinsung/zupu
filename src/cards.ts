import { h } from './dom'
import { t, tn } from './i18n'
import { icon } from './icons'
import { type Marriage, type ParentKind, type Person, UNKNOWN, age, allNames, displayName, lifespan } from './model'

/**
 * e.g. "結婚 / Married 1962 · 離婚 / Divorced 1975", or the status where there's no date to say it
 * ("已婚 / Married", "結婚 / Married 1962 · 已離婚 / Divorced"); '' if nothing is recorded.
 * Partial because history snapshots from before `status` existed lack it.
 */
export function marriageText(m: Partial<Marriage> | undefined): string {
  if (!m) return ''
  const status = m.status === 'married' ? t.statusMarried : m.status === 'divorced' ? t.statusDivorced
    : m.status === 'unmarried' ? t.statusUnmarried : ''
  const parts = [m.married && `${t.married} ${m.married}`, m.divorced && `${t.divorced} ${m.divorced}`]
  if (m.status === 'divorced' && !m.divorced) parts.push(status)
  return parts.filter(Boolean).join(' · ') || status
}

/** Secondary line for a person: their other names and years. */
export function personSubtitle(p: Person): string {
  return [allNames(p).filter(n => n !== displayName(p)).join(' · '), lifespan(p)].filter(Boolean).join(' · ')
}

/** e.g. "1985-03-14 · 41歲 / age 41" or "1920 – 1990-07 · 享年約70 / aged about 70".
 * Deceased with no death date reads "1890 – ?" without an age, or 已故 / Deceased with no dates; '' if no dates. */
export function datesLine(p: Person): string {
  const dates = p.deathDate ? `${p.birthDate || '?'} – ${p.deathDate}`
    : p.deceased === 'yes' ? (p.birthDate ? `${p.birthDate} – ?` : t.deceased) : p.birthDate
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

/** Card tag for a non-birth parent link, from the parent's or the child's side; '' for birth. */
export function parentKindTag(kind: ParentKind | undefined, side: 'parent' | 'child'): string {
  if (!kind) return ''
  const tags = {
    adoptive: [t.adoptiveParent, t.adoptedChild],
  }[kind]
  return tags[side === 'parent' ? 0 : 1]
}

/** "男 / male", "女 / female", or '' if not recorded. */
export function genderWord(p: Person): string {
  return p.gender === 'M' ? t.maleWord : p.gender === 'F' ? t.femaleWord : ''
}

/**
 * A tappable row for one person; the colored edge shows gender. `extra` goes on the right (e.g. a
 * remove button). With `onclick` null the row isn't a link, so `extra` is its only control.
 * `tag` (e.g. from parentKindTag) leads the subtitle.
 */
export function personCard(p: Person, onclick: (() => void) | null, extra?: Node, tag = ''): HTMLElement {
  const sub = [tag, personSubtitle(p)].filter(Boolean).join(' · ')
  // The colored edge shows gender; screen readers get it as a word.
  const gender = genderWord(p)
  const main = h(onclick ? 'button' : 'div', { type: onclick ? 'button' : undefined, class: 'pcard-main', onclick: onclick ?? undefined },
    h('span', { class: 'pcard-name' }, displayName(p)),
    gender ? h('span', { class: 'sr-only' }, `, ${gender}`) : null,
    sub ? h('span', { class: 'pcard-sub' }, sub) : null)
  return h('div', { class: `pcard g-${p.gender || 'U'}`, 'data-id': p.id }, main, extra ?? h('span', { class: 'pcard-chev', 'aria-hidden': 'true' }, icon('chevronRight')))
}

/** The current person shown among their siblings: same shape as a card, but not a link. */
export function selfCard(p: Person): HTMLElement {
  return h('div', { class: `pcard self g-${p.gender || 'U'}`, 'aria-current': 'page' },
    h('div', { class: 'pcard-main' },
      h('span', { class: 'pcard-name' }, displayName(p)),
      h('span', { class: 'pcard-sub' }, [t.self, lifespan(p)].filter(Boolean).join(' · '))))
}
