import { h } from './dom'
import { type Key, L, colon } from './i18n'

const KEY = 'ft-me'

/** Who this device's user is, for kinship terms; per device like the editor name. '' when unset. Callers treat an id no longer in the data as unset. */
export function getMe(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setMe(id: string) {
  if (id) localStorage.setItem(KEY, id)
  else localStorage.removeItem(KEY)
}

/**
 * The 我是 row: who you are (— before anyone is chosen) with a button to choose or change it, then
 * `hint`, saying what it's for on this page. `update` changes the row in place, keeping the button,
 * so focus can go back to it when the dialog closes.
 */
export function meChooser(hint: Key, askMe: () => void) {
  const name = h('span', {})
  const button = h('button', { type: 'button', class: 'chip', onclick: () => askMe() })
  const el = h('div', { class: 'me-chooser' },
    h('p', { class: 'me-row' }, h('span', {}, L('meLabel'), colon, name), button),
    h('p', { class: 'me-why' }, L(hint)))
  return {
    el,
    update(who: string | undefined) {
      name.replaceChildren(who ? h('strong', {}, who) : '—')
      button.replaceChildren(L(who ? 'change' : 'choose'))
    },
  }
}
