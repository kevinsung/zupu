import { h, wide } from './dom'
import { L, t } from './i18n'
import { type Marriage, type Person, type PersonFields, emptyFields, isValidEmail, isValidPartialDate, normalizePhone, searchPeople, type People } from './model'
import { personCard } from './cards'
import { type IconName, icon } from './icons'

export interface DialogAction {
  label: string | Node
  primary?: boolean
  danger?: boolean
  /** Return false to keep the dialog open (e.g. validation failed). */
  run?: () => Promise<boolean | void> | boolean | void
}

export interface DialogOpts {
  /** Called when the dialog is dismissed with ✕, Esc or a backdrop tap (not after an action). */
  onDismiss?: () => void
  cls?: string
  /** Muted second line under the title, e.g. the person being edited. */
  subtitle?: string
  /** Replaces the title in the header (the phone search puts its input there). */
  head?: Node
}

let dialogSeq = 0

/**
 * Modal dialog: a centered card on wide screens, a bottom sheet on phones.
 *
 * Buttons stay at the top, never the bottom: on phones the keyboard or a browser autofill bar
 * can cover the bottom of the screen. A dialog with a single primary action puts it in the
 * header row, opposite ✕ (which doubles as Cancel); other dialogs get an action bar under the
 * header. Errors show right below that. Returns a function that closes the dialog.
 */
export function openDialog(title: string | Node, body: Node, actions: DialogAction[], opts: DialogOpts = {}): () => void {
  const error = h('p', { class: 'dlg-error', role: 'alert' })
  const dismiss = () => { opts.onDismiss?.(); close() }
  const button = (a: DialogAction) => {
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
  }
  const inHeader = actions.length === 1 && actions[0].primary && !opts.cls?.includes('confirm')
  const titleId = `dlg-title-${++dialogSeq}`
  const x = h('button', { type: 'button', class: 'icon dlg-x', 'aria-label': t.close, title: t.close, onclick: dismiss }, icon('close'))
  const heading = opts.head ?? h('div', { class: 'dlg-title' },
    h('h2', { id: titleId }, title),
    opts.subtitle ? h('p', { class: 'dlg-sub' }, opts.subtitle) : null)
  const dlg = h('dialog', { class: ['dlg', inHeader && 'with-save', opts.cls].filter(Boolean).join(' '), 'aria-labelledby': opts.head ? undefined : titleId },
    h('div', { class: 'dlg-head' }, ...(inHeader ? [x, heading, button(actions[0])] : [heading, x])),
    !inHeader && actions.length ? h('div', { class: 'dlg-actions' }, ...actions.map(button)) : null,
    h('div', { class: 'dlg-body' }, error, body),
  )
  if (opts.head && typeof title === 'string') dlg.setAttribute('aria-label', title)
  const close = () => { dlg.close(); dlg.remove() }
  dlg.addEventListener('cancel', e => { e.preventDefault(); dismiss() })
  // Tapping the backdrop (outside the dialog box) dismisses it.
  dlg.addEventListener('click', e => { if (e.target === dlg) dismiss() })
  closePopover()
  document.body.append(dlg)
  dlg.showModal()
  return close
}

export function confirmDialog(message: string, label: string, danger = false): Promise<boolean> {
  return new Promise(resolve => {
    openDialog(message, h('div'), [
      { label: t.cancel, run: () => resolve(false) },
      { label, primary: !danger, danger, run: () => resolve(true) },
    ], { onDismiss: () => resolve(false), cls: 'confirm' })
  })
}

let popover: { el: HTMLElement; anchor: HTMLElement; close: () => void } | null = null

export function closePopover() {
  popover?.close()
}

/**
 * A menu next to `anchor` on wide screens; a bottom sheet on phones (or without an anchor).
 * Arrow keys move between its buttons and Esc closes it. Returns a function that closes it.
 */
export function openMenu(title: string, body: HTMLElement, anchor?: HTMLElement): () => void {
  if (!anchor || !wide.matches) return openDialog(title, body, [], { cls: 'sheet-menu' })
  // A second click on the same button closes its menu.
  if (popover?.anchor === anchor) { closePopover(); return () => {} }
  closePopover()

  const el = h('div', { class: 'popover', role: 'dialog', 'aria-label': title }, body)
  const close = () => {
    el.remove()
    anchor.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', close)
    if (popover?.el === el) popover = null
  }
  const onDown = (e: Event) => {
    const target = e.target as Node
    if (!el.contains(target) && !anchor.contains(target)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
      if (next) { e.preventDefault(); next.focus() }
    }
  }
  document.body.append(el)
  anchor.setAttribute('aria-expanded', 'true')
  placeNear(el, anchor)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', close)
  popover = { el, anchor, close }
  el.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  return close
}

/** Below the anchor (above it if there's no room), aligned to whichever edge keeps it on screen. */
function placeNear(el: HTMLElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect()
  const gap = 6
  const margin = 8
  el.style.maxHeight = `${innerHeight - 2 * margin}px`
  const { width, height } = el.getBoundingClientRect()
  const left = r.left + width > innerWidth - margin ? Math.max(margin, r.right - width) : r.left
  const below = r.bottom + gap
  const top = below + height <= innerHeight - margin ? below : Math.max(margin, r.top - gap - height)
  el.style.left = `${left}px`
  el.style.top = `${top}px`
}

export interface MenuItem {
  icon: IconName
  label: string | Node
  run: () => void
  danger?: boolean
  disabled?: string
}

/** A list of actions: an anchored menu on wide screens, a sheet of large tap targets on phones. */
export function actionSheet(title: string, items: (MenuItem | null)[], anchor?: HTMLElement) {
  let close = () => {}
  close = openMenu(title, menuList(items, () => close()), anchor)
}

export function menuList(items: (MenuItem | null)[], close: () => void): HTMLElement {
  return h('div', { class: 'menu', role: 'menu' }, ...items.filter((x): x is MenuItem => !!x).map(item =>
    h('button', {
      type: 'button', role: 'menuitem', class: item.danger ? 'menu-item danger' : 'menu-item', disabled: !!item.disabled,
      onclick: () => { close(); item.run() },
    }, icon(item.icon, 'menu-icon'),
    h('span', { class: 'menu-label' }, item.label, item.disabled ? h('small', {}, item.disabled) : null))))
}

/** A row of mutually exclusive buttons (aria-pressed). */
export function segmented<V extends string>(label: string, options: [V, string | Node][], current: V, onPick: (v: V) => void): HTMLElement {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label })
  for (const [value, text] of options) {
    const btn = h('button', { type: 'button', 'aria-pressed': String(value === current), onclick: () => {
      group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)))
      onPick(value)
    } }, text)
    group.append(btn)
  }
  return group
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

export function copyText(text: string) {
  navigator.clipboard?.writeText(text).then(() => toast(t.copied), () => toast(text)) ?? toast(text)
}

function field(label: string | Node, input: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('small', {}, hint) : null)
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
  const phone = text('phone', { type: 'tel', placeholder: '+886 912 345 678' })
  const address = h('textarea', { name: 'address', rows: '2' })
  address.value = initial.address
  const line = text('line')
  const signal = text('signal')
  const notes = h('textarea', { name: 'notes', rows: '3' })
  notes.value = initial.notes
  const radio = (value: string, label: string | Node) =>
    h('label', { class: 'seg-option' }, h('input', { type: 'radio', name: 'gender', value, checked: initial.gender === value }), h('span', {}, label))
  const gender = h('div', { class: 'seg seg-radios', role: 'radiogroup', 'aria-label': t.gender },
    radio('M', L('male')), radio('F', L('female')), radio('', L('unknownGender')))
  const hasContact = !!(initial.email || initial.phone || initial.address || initial.line || initial.signal)

  const el = h('div', { class: 'form' },
    field(L('nameZh'), nameZh),
    field(L('nameEn'), nameEn),
    field(L('otherNames'), otherNames, t.otherNamesHint),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, L('gender')), gender),
    h('div', { class: 'row' }, field(L('birthDate'), birthDate), field(L('deathDate'), deathDate)),
    h('small', { class: 'form-hint' }, t.dateHint),
    h('details', { class: 'form-group', open: hasContact },
      h('summary', {}, icon('chevronRight'), h('span', {}, L('contact'))),
      h('div', { class: 'form' },
        h('div', { class: 'row' }, field(L('email'), email), field(L('phone'), phone, t.phoneHint)),
        field(L('line'), line, t.lineHint),
        field(L('signal'), signal, t.signalHint),
        field(L('address'), address))),
    field(L('notes'), notes),
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
    }
    if (!isValidPartialDate(fields.birthDate) || !isValidPartialDate(fields.deathDate)) throw new Error(t.badDate)
    if (!isValidEmail(fields.email)) throw new Error(t.badEmail)
    const phoneE164 = normalizePhone(fields.phone)
    if (phoneE164 === null) throw new Error(t.badPhone)
    return { ...fields, phone: phoneE164 }
  }

  return { el, read, focus: () => nameZh.focus() }
}

/** Marriage dates form. `read()` returns the dates, or throws a user-facing message. */
export function marriageForm(initial: Marriage) {
  const date = (name: keyof Marriage) =>
    h('input', { type: 'text', name, value: initial[name], autocomplete: 'off', placeholder: 'YYYY-MM-DD', inputmode: 'numeric' })
  const married = date('married')
  const divorced = date('divorced')
  const el = h('div', { class: 'form' },
    h('div', { class: 'row' }, field(L('marriedDate'), married), field(L('divorcedDate'), divorced)),
    h('small', { class: 'form-hint' }, t.dateHint))
  function read(): Marriage {
    const m = { married: married.value.trim(), divorced: divorced.value.trim() }
    if (!isValidPartialDate(m.married) || !isValidPartialDate(m.divorced)) throw new Error(t.badDate)
    return m
  }
  return { el, read, focus: () => married.focus() }
}

/**
 * Search box with a result list; calls onPick with the chosen person. `idle` fills the list while the box is empty.
 * With `selectable`, picking only highlights the person (read it back with `selected()`) and keeps the results.
 * Pass `input` to drive the list from an existing box (the top-bar search). Arrow keys move
 * from the box into the results and between them.
 */
export function personPicker(
  people: () => People,
  onPick: (p: Person) => void,
  opts: { placeholder?: string; exclude?: string; idle?: () => Node[]; selectable?: boolean; input?: HTMLInputElement } = {},
) {
  const placeholder = opts.placeholder ?? t.search
  const input = opts.input ?? h('input', { type: 'search', placeholder, autocomplete: 'off', enterkeyhint: 'go', 'aria-label': placeholder })
  const list = h('div', { class: 'picker-results' })
  let selectedId: string | undefined
  const pick = (p: Person) => {
    if (opts.selectable) selectedId = p.id
    else input.value = ''
    onPick(p)
    update()
  }
  const card = (p: Person) => {
    const el = personCard(p, () => pick(p))
    if (opts.selectable) {
      const on = p.id === selectedId
      el.classList.toggle('selected', on)
      el.querySelector('.pcard-main')?.setAttribute('aria-pressed', String(on))
      el.querySelector('.pcard-chev')?.replaceChildren(...(on ? [icon('check')] : []))
    }
    return el
  }
  const update = () => {
    const q = input.value
    if (!q.trim()) { list.replaceChildren(...(opts.idle?.() ?? [])); return }
    const results = searchPeople(people(), q).filter(p => p.id !== opts.exclude)
    list.replaceChildren(results.length
      ? h('div', { class: 'cards' }, ...results.map(card))
      : h('p', { class: 'muted pad' }, t.noResults))
  }
  const results = () => [...list.querySelectorAll<HTMLButtonElement>('.pcard-main')]
  input.addEventListener('input', update)
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      const first = results()[0]
      if (first) { e.preventDefault(); first.focus() }
      return
    }
    if (e.key !== 'Enter') return
    const first = searchPeople(people(), input.value).find(p => p.id !== opts.exclude)
    if (first) { e.preventDefault(); pick(first) }
  })
  list.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const all = results()
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    const next = all[i + (e.key === 'ArrowDown' ? 1 : -1)]
    ;(next ?? (e.key === 'ArrowUp' ? input : all[i])).focus()
  })
  update()
  const selected = () => (selectedId ? people().get(selectedId) : undefined)
  return { el: h('div', { class: 'picker' }, opts.input ? null : input, list), input, list, refresh: update, selected }
}

/** A small header label for a section, with an optional compact action button on the right. */
export function sectionHead(title: Node, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'section-head' }, h('h3', { class: 'section-title' }, title), action ?? null)
}
