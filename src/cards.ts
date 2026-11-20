import { h } from './dom'
import { type Key, type Pair, L, both, pair, pairName, t, tn } from './i18n'
import { icon } from './icons'
import type { Kin } from './kinship'
import { type Marriage, type ParentKind, type Person, UNKNOWN, age, allNames, displayName, isDeceased, lifespan } from './model'

/**
 * Labels with their dates, each date once (e.g. 結婚 Married 1962 · 離婚 Divorced 1975), or the status
 * where there's no date to say it (已婚 Married; 結婚 Married 1962 · 已離婚 Divorced); null if nothing
 * is recorded. Partial because history snapshots from before `status` existed lack it.
 */
export function marriageText(m: Partial<Marriage> | undefined): Node | null {
  if (!m) return null
  const statusKey: Key | null = m.status === 'married' ? 'statusMarried' : m.status === 'divorced' ? 'statusDivorced'
    : m.status === 'unmarried' ? 'statusUnmarried' : null
  const parts: (Node | string)[][] = []
  if (m.married) parts.push([L('married'), ` ${m.married}`])
  if (m.divorced) parts.push([L('divorced'), ` ${m.divorced}`])
  else if (m.status === 'divorced' && statusKey) parts.push([L(statusKey)])
  if (!parts.length) return statusKey ? L(statusKey) : null
  const frag = document.createDocumentFragment()
  parts.forEach((nodes, i) => frag.append(...(i ? [' · '] : []), ...nodes))
  return frag
}

/** Years for a card ("1920–1990", "1920–?"), or 已故 / Deceased if marked deceased with no dates; '' if neither. */
export function cardYears(p: Person): string {
  return lifespan(p) || (isDeceased(p) ? t.deceased : '')
}

/** The names a person goes by besides the one they're shown under, e.g. "John Wang · Ah Ming". */
export function otherNamesLine(p: Person): string {
  const name = displayName(p)
  return allNames(p).filter(n => n !== name).join(' · ')
}

/**
 * Secondary line for a person: `tag` (e.g. 本人 / This person), years, then other names. The years come
 * before the names so a long list of names, cut off at the card's edge, doesn't hide them.
 */
export function personSubtitle(p: Person, tag = ''): string {
  return [tag, cardYears(p), otherNamesLine(p)].filter(Boolean).join(' · ')
}

/** e.g. "1985-03-14 · 41歲 / age 41" or "1920 – 1990-07 · 享年約70歲 / aged about 70".
 * Deceased with no death date reads "1890 – ?" without an age, or 已故 / Deceased with no dates; '' if no dates. */
export function datesLine(p: Person): string {
  const dates = p.deathDate ? `${p.birthDate || '?'} – ${p.deathDate}`
    : p.deceased === 'yes' ? (p.birthDate ? `${p.birthDate} – ?` : t.deceased) : p.birthDate
  const a = age(p)
  const ageText = a && tn(a.atDeath ? (a.approx ? 'agedAtDeathApprox' : 'agedAtDeath') : (a.approx ? 'ageApprox' : 'age'), a.years)
  return [dates, ageText].filter(Boolean).join(' · ')
}

/** What the kinship term reads on a card, in the chosen language(s), e.g. "堂哥 / older cousin". */
export function kinText(kin: Kin | 'self'): string {
  if (kin === 'self') return t.meTag
  return both([kin.zh, kin.en])
}

let kinOf: (p: Person) => string = () => ''

/** Where cards get a person's kinship term to the user (set by main, which knows who that is); '' for none. */
export function setKinOf(fn: (p: Person) => string) {
  kinOf = fn
}

/**
 * A card's lines under the name: the kinship term on a line of its own (in the accent color, so it
 * isn't cut off with the years in a narrow card), then `personSubtitle`. Either may be absent.
 */
function cardLines(p: Person, tag = ''): (HTMLElement | null)[] {
  const kin = kinOf(p)
  const rest = personSubtitle(p, tag)
  return [kin ? h('span', { class: 'pcard-kin' }, kin) : null, rest ? h('span', { class: 'pcard-sub' }, rest) : null]
}

/** A circle with the first character of the name, tinted by gender. */
export function avatar(p: Person, cls = ''): HTMLElement {
  const name = displayName(p)
  const initial = name === UNKNOWN ? '?' : [...name][0].toUpperCase()
  return h('span', { class: `avatar g-${p.gender || 'U'} ${cls}`.trim(), 'aria-hidden': 'true' }, initial)
}

/** How a half sibling is related, from the one parent they share: "同父異母 / Half · same father" etc. */
export function halfTag(parent: Person | undefined): Pair {
  return parent?.gender === 'M' ? pair('halfPaternal') : parent?.gender === 'F' ? pair('halfMaternal') : pairName('halfVia', displayName(parent))
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
  // The colored edge shows gender; screen readers get it as a word.
  const gender = genderWord(p)
  const main = h(onclick ? 'button' : 'div', { type: onclick ? 'button' : undefined, class: 'pcard-main', onclick: onclick ?? undefined },
    h('span', { class: 'pcard-name' }, displayName(p)),
    gender ? h('span', { class: 'sr-only' }, `, ${gender}`) : null,
    ...cardLines(p, tag))
  return h('div', { class: `pcard g-${p.gender || 'U'}`, 'data-id': p.id }, main, extra ?? h('span', { class: 'pcard-chev', 'aria-hidden': 'true' }, icon('chevronRight')))
}

/** The current person shown among their siblings: same shape as a card, but not a link. */
export function selfCard(p: Person): HTMLElement {
  return h('div', { class: `pcard self g-${p.gender || 'U'}`, 'aria-current': 'page' },
    h('div', { class: 'pcard-main' },
      h('span', { class: 'pcard-name' }, displayName(p)),
      ...cardLines(p, t.self)))
}
