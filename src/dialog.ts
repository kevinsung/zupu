import { h } from './dom'
import { t } from './i18n'
import { type Person, type PersonFields, emptyFields, isValidEmail, isValidPartialDate, searchPeople, type People } from './model'
import { personCard } from './cards'

export interface DialogAction {
  label: string
  primary?: boolean
  danger?: boolean
  /** Return false to keep the dialog open (e.g. validation failed). */
  run?: () => Promise<boolean | void> | boolean | void
}

/**
 * Modal dialog: a centered card on wide screens, a bottom sheet on phones. The body scrolls
 * between a fixed title bar and action bar. Returns a function that closes it.
 */
export function openDialog(title: string, body: Node, actions: DialogAction[], onDismiss?: () => void, cls = ''): () => void {
  const error = h('p', { class: 'dlg-error', role: 'alert' })
  const dismiss = () => { onDismiss?.(); close() }
  const dlg = h('dialog', { class: `dlg ${cls}`.trim() },
    h('div', { class: 'dlg-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon dlg-x', 'aria-label': t.close, title: t.close, onclick: dismiss }, '✕')),
    h('div', { class: 'dlg-body' }, body, error),
    actions.length ? h('div', { class: 'dlg-actions' }, ...actions.map(a => {
      const btn = h('button', { type: 'button', class: [a.primary && 'primary', a.danger && 'danger'].filter(Boolean).join(' ') }, a.label)
      btn.addEventListener('click', async () => {
        error.textContent = ''
        btn.disabled = true
        try {
          if ((await a.run?.()) !== false) close()
        } catch (e) {
          error.textContent = `${t.saveFailed}: ${(e as Error).message}`
          error.scrollIntoView?.({ block: 'nearest' })
        } finally {
          btn.disabled = false
        }
      })
      return btn
    })) : null,
  )
  const close = () => { dlg.close(); dlg.remove() }
  dlg.addEventListener('cancel', e => { e.preventDefault(); dismiss() })
  // Tapping the backdrop (outside the dialog box) dismisses it.
  dlg.addEventListener('click', e => { if (e.target === dlg) dismiss() })
  document.body.append(dlg)
  dlg.showModal()
  return close
}

export function confirmDialog(message: string, label: string, danger = false): Promise<boolean> {
  return new Promise(resolve => {
    openDialog(message, h('div'), [
      { label: t.cancel, run: () => resolve(false) },
      { label, primary: !danger, danger, run: () => resolve(true) },
    ], () => resolve(false), 'confirm')
  })
}

export interface MenuItem {
  icon: string
  label: string
  run: () => void
  danger?: boolean
  disabled?: string
}

/** A list of large tappable actions (the phone "more" menu). */
export function actionSheet(title: string, items: (MenuItem | null)[]) {
  let close = () => {}
  const list = h('div', { class: 'menu' }, ...items.filter((x): x is MenuItem => !!x).map(item =>
    h('button', {
      type: 'button', class: item.danger ? 'menu-item danger' : 'menu-item', disabled: !!item.disabled,
      onclick: () => { close(); item.run() },
    }, h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, item.icon),
    h('span', {}, item.label, item.disabled ? h('small', {}, item.disabled) : null))))
  close = openDialog(title, list, [], undefined, 'sheet-menu')
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
/** Brief message at the bottom of the screen. */
export function toast(message: string) {
  let el = document.querySelector<HTMLElement>('.toast')
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' })
    document.body.append(el)
  }
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500)
}

function field(label: string, input: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null)
}

/** Person fields form. `read()` returns the fields, or throws a user-facing message. */
export function personForm(initial: PersonFields = emptyFields()) {
  const text = (name: keyof PersonFields, extra: Record<string, string> = {}) =>
    h('input', { type: 'text', name, value: initial[name], autocomplete: 'off', ...extra })
  const nameZh = text('nameZh')
  const nameEn = text('nameEn')
  const otherNames = text('otherNames')
  const birthDate = text('birthDate', { placeholder: 'YYYY-MM-DD', inputmode: 'numeric' })
  const deathDate = text('deathDate', { placeholder: 'YYYY-MM-DD', inputmode: 'numeric' })
  const email = text('email', { type: 'email', inputmode: 'email' })
  const phone = text('phone', { type: 'tel' })
  const address = h('textarea', { name: 'address', rows: '2' })
  address.value = initial.address
  const line = text('line')
  const signal = text('signal')
  const whatsapp = text('whatsapp')
  const notes = h('textarea', { name: 'notes', rows: '3' })
  notes.value = initial.notes
  const radio = (value: string, label: string) =>
    h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'gender', value, checked: initial.gender === value }), label)
  const gender = h('div', { class: 'radios' }, radio('M', t.male), radio('F', t.female), radio('', t.unknownGender))

  const el = h('div', { class: 'form' },
    field(t.nameZh, nameZh),
    field(t.nameEn, nameEn),
    field(t.otherNames, otherNames, t.otherNamesHint),
    h('div', { class: 'field' }, h('span', {}, t.gender), gender),
    h('div', { class: 'row' }, field(t.birthDate, birthDate, t.dateHint), field(t.deathDate, deathDate)),
    h('h3', { class: 'form-section' }, t.contact),
    h('div', { class: 'row' }, field(t.email, email), field(t.phone, phone)),
    field(t.address, address),
    h('div', { class: 'row' }, field(t.line, line), field(t.signal, signal), field(t.whatsapp, whatsapp)),
    field(t.notes, notes),
  )

  function read(): PersonFields {
    const g = (gender.querySelector('input:checked') as HTMLInputElement | null)?.value ?? ''
    const fields: PersonFields = {
      nameZh: nameZh.value.trim(),
      nameEn: nameEn.value.trim(),
      otherNames: otherNames.value.trim(),
      gender: g === 'M' || g === 'F' ? g : '',
      birthDate: birthDate.value.trim(),
      deathDate: deathDate.value.trim(),
      notes: notes.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim(),
      address: address.value.trim(),
      line: line.value.trim(),
      signal: signal.value.trim(),
      whatsapp: whatsapp.value.trim(),
    }
    if (!isValidPartialDate(fields.birthDate) || !isValidPartialDate(fields.deathDate)) throw new Error(t.badDate)
    if (!isValidEmail(fields.email)) throw new Error(t.badEmail)
    return fields
  }

  return { el, read, focus: () => nameZh.focus() }
}

/** Search box with a result list; calls onPick with the chosen person. `idle` fills the list while the box is empty. */
export function personPicker(
  people: () => People,
  onPick: (p: Person) => void,
  opts: { placeholder?: string; exclude?: string; idle?: () => Node[] } = {},
) {
  const input = h('input', { type: 'search', placeholder: opts.placeholder ?? t.search, autocomplete: 'off', enterkeyhint: 'go', 'aria-label': opts.placeholder ?? t.search })
  const list = h('div', { class: 'picker-results' })
  const pick = (p: Person) => { onPick(p); input.value = ''; update() }
  const update = () => {
    const q = input.value
    if (!q.trim()) { list.replaceChildren(...(opts.idle?.() ?? [])); return }
    const results = searchPeople(people(), q).filter(p => p.id !== opts.exclude)
    list.replaceChildren(results.length
      ? h('div', { class: 'cards' }, ...results.map(p => personCard(p, () => pick(p))))
      : h('p', { class: 'muted pad' }, t.noResults))
  }
  input.addEventListener('input', update)
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    const first = searchPeople(people(), input.value).find(p => p.id !== opts.exclude)
    if (first) { e.preventDefault(); pick(first) }
  })
  update()
  return { el: h('div', { class: 'picker' }, input, list), input, refresh: update }
}
