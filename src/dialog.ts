import { h, wide } from './dom'
import { L, lang, t, tn, type Key } from './i18n'
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
  const seq = ++dialogSeq
  const titleId = `dlg-title-${seq}`
  const subId = `dlg-sub-${seq}`
  const errorId = `dlg-error-${seq}`
  const error = h('p', { class: 'dlg-error', role: 'alert', id: errorId })
  const dismiss = () => { opts.onDismiss?.(); close() }
  // The input named by the last validation error (see fieldError), marked until the next attempt.
  let invalid: HTMLElement | undefined
  const button = (a: DialogAction) => {
    const btn = h('button', { type: 'button', class: [a.primary && 'primary', a.danger && 'danger'].filter(Boolean).join(' ') }, a.label)
    btn.addEventListener('click', async () => {
      error.textContent = ''
      if (invalid) {
        invalid.removeAttribute('aria-invalid')
        describedBy(invalid, errorId, false)
      }
      invalid = undefined
      btn.disabled = true
      try {
        if ((await a.run?.()) !== false) close()
      } catch (e) {
        error.textContent = `${t.saveFailed}: ${(e as Error).message}`
        invalid = (e as FieldError).field
        if (invalid) {
          invalid.setAttribute('aria-invalid', 'true')
          describedBy(invalid, errorId, true)
          // A collapsed section (Contact) hides the input, and focus() would silently fail.
          for (let d = invalid.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true
          invalid.focus()
        } else {
          error.scrollIntoView?.({ block: 'nearest' })
        }
      } finally {
        btn.disabled = false
      }
    })
    return btn
  }
  const inHeader = actions.length === 1 && actions[0].primary
  const x = h('button', { type: 'button', class: 'icon dlg-x', 'aria-label': t.close, title: t.close, onclick: dismiss }, icon('close'))
  const heading = opts.head ?? h('div', { class: 'dlg-title' },
    h('h2', { id: titleId }, title),
    opts.subtitle ? h('p', { class: 'dlg-sub', id: subId }, opts.subtitle) : null)
  // The subtitle says who the dialog is about ("Edit" alone doesn't), so it's read with the title.
  const dlg = h('dialog', {
    class: ['dlg', inHeader && 'with-save', opts.cls].filter(Boolean).join(' '),
    'aria-labelledby': opts.head ? undefined : titleId,
    'aria-describedby': !opts.head && opts.subtitle ? subId : undefined,
  },
    h('div', { class: 'dlg-head' }, ...(inHeader ? [x, heading, button(actions[0])] : [heading, x])),
    !inHeader && actions.length ? h('div', { class: 'dlg-actions' }, ...actions.map(button)) : null,
    h('div', { class: 'dlg-body' }, error, body),
  )
  if (opts.head && typeof title === 'string') dlg.setAttribute('aria-label', title)
  // Return focus to what opened the dialog. Saving often re-renders the page, which replaces that
  // button, so then fall back to the dialog underneath or the person's name.
  const opener = document.activeElement as HTMLElement | null
  const close = () => {
    dlg.close()
    dlg.remove()
    if (opener && opener !== document.body && opener.isConnected && !opener.matches(':disabled')) { opener.focus({ preventScroll: true }); return }
    const under = [...document.querySelectorAll<HTMLElement>('dialog[open]')].at(-1)
    if (under) under.querySelector<HTMLElement>('.dlg-body :is(input, select, textarea), button')?.focus({ preventScroll: true })
    else focusPersonHeading()
  }
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

  // tabindex -1: a click on the menu's padding or a label focuses the menu, not <body>, so it
  // doesn't count as focus leaving (see onFocusOut).
  const el = h('div', { class: 'popover', role: 'dialog', 'aria-label': title, tabindex: '-1' }, body)
  const close = () => {
    // If focus was in the menu (an item was chosen), hand it back to the button so that a dialog
    // the item opens can return there too.
    const hadFocus = el.contains(document.activeElement)
    el.removeEventListener('focusout', onFocusOut)
    el.remove()
    if (hadFocus) anchor.focus({ preventScroll: true })
    anchor.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('pointercancel', onUp, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', close)
    if (popover?.el === el) popover = null
  }
  // Set while a pointer is down. Presses are handled here, not by onFocusOut: Safari doesn't focus
  // a clicked button, so a second click on the anchor would blur the menu to <body>, closing it
  // only for the click to open it again.
  let pressing = false
  const onDown = (e: Event) => {
    pressing = true
    const target = e.target as Node
    if (!el.contains(target) && !anchor.contains(target)) close()
  }
  const onUp = () => { pressing = false }
  // The menu is at the end of <body>, so Tab from its last item leaves the page (Shift+Tab from the
  // first lands somewhere unrelated) with the menu still covering content. Close it and go back
  // to its button.
  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null
    if (pressing || (next && (el.contains(next) || anchor.contains(next)))) return
    close()
    anchor.focus({ preventScroll: true })
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
  el.addEventListener('focusout', onFocusOut)
  anchor.setAttribute('aria-expanded', 'true')
  placeNear(el, anchor)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('pointercancel', onUp, true)
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

/**
 * Unavailable items stay focusable (aria-disabled rather than disabled) so keyboard and
 * screen-reader users can reach them and hear why, from the `disabled` reason shown under the label.
 */
export function menuList(items: (MenuItem | null)[], close: () => void): HTMLElement {
  return h('div', { class: 'menu', role: 'menu' }, ...items.filter((x): x is MenuItem => !!x).map(item =>
    h('button', {
      type: 'button', role: 'menuitem', class: item.danger ? 'menu-item danger' : 'menu-item',
      'aria-disabled': item.disabled ? 'true' : undefined,
      onclick: () => { if (item.disabled) return; close(); item.run() },
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

/** Moves focus to the current person's name (the page's h1), e.g. after the control that had it was re-rendered. */
export function focusPersonHeading() {
  document.querySelector<HTMLElement>('#person h1')?.focus({ preventScroll: true })
}

/**
 * Adds the toast's live region to the page. Called at startup: screen readers may skip a message
 * put into a live region that was created at the same moment.
 */
export function mountToast(): HTMLElement {
  let el = document.querySelector<HTMLElement>('.toast')
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' })
    document.body.append(el)
  }
  return el
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
/**
 * Brief message at the bottom of the screen. While a modal dialog is open the rest of the page is
 * inert and under the backdrop, so a toast there could be neither seen nor heard: the message
 * goes into the top dialog's error line (an alert) instead.
 */
export function toast(message: string) {
  const alert = [...document.querySelectorAll('dialog[open]')].at(-1)?.querySelector<HTMLElement>('.dlg-error')
  if (alert) {
    alert.textContent = message
    alert.scrollIntoView?.({ block: 'nearest' })
    return
  }
  const el = mountToast()
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500)
}

export function copyText(text: string) {
  navigator.clipboard?.writeText(text).then(() => toast(t.copied), () => toast(text)) ?? toast(text)
}

/** Adds or removes one id in an element's aria-describedby, keeping any others (e.g. a field hint). */
function describedBy(el: HTMLElement, id: string, on: boolean) {
  const ids = new Set((el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean))
  if (on) ids.add(id)
  else ids.delete(id)
  if (ids.size) el.setAttribute('aria-describedby', [...ids].join(' '))
  else el.removeAttribute('aria-describedby')
}

/** A validation error that names the input at fault, so the dialog can mark and focus it. */
type FieldError = Error & { field?: HTMLElement }

function fieldError(message: string, field: HTMLElement): FieldError {
  return Object.assign(new Error(message), { field })
}

/**
 * A date that may be partial (YYYY, YYYY-MM or YYYY-MM-DD) as separate year, month and day
 * boxes. One box with dashes didn't work on iPhones, whose number pad has no "-".
 * `read()` returns the date with month and day zero-padded, or throws a FieldError.
 */
function partialDateField(label: Key, name: string, initial: string) {
  const [y = '', m = '', d = ''] = initial ? initial.split('-') : []
  const placeholders = lang === 'zh' ? ['年', '月', '日'] : ['YYYY', 'MM', 'DD']
  const part = (suffix: string, value: string, maxlength: number, ariaLabel: string, i: number) => h('input', {
    type: 'text', name: `${name}-${suffix}`, value, inputmode: 'numeric', pattern: '[0-9]*', maxlength: String(maxlength),
    autocomplete: 'off', 'aria-label': ariaLabel, placeholder: placeholders[i], class: `date-${suffix}`,
  })
  const year = part('y', y, 4, t.year, 0)
  const month = part('m', m, 2, t.month, 1)
  const day = part('d', d, 2, t.day, 2)
  const el = h('fieldset', { class: 'field date-field' },
    h('legend', { class: 'field-label' }, L(label)),
    h('div', { class: 'date-parts' }, year, month, day))

  function read(): string {
    const [yv, mv, dv] = [year, month, day].map(i => i.value.trim())
    const fail = (msg: string, input: HTMLElement) => fieldError(`${t[label]}: ${msg}`, input)
    if (!yv && mv) throw fail(t.monthNeedsYear, year)
    if (!mv && dv) throw fail(t.dayNeedsMonth, month)
    if (yv && !/^\d{4}$/.test(yv)) throw fail(t.badYear, year)
    if (mv && !(/^\d{1,2}$/.test(mv) && +mv >= 1 && +mv <= 12)) throw fail(t.badMonth, month)
    if (dv && !(/^\d{1,2}$/.test(dv) && +dv >= 1 && +dv <= 31)) throw fail(t.badDay, day)
    const date = [yv, mv && mv.padStart(2, '0'), dv && dv.padStart(2, '0')].filter(Boolean).join('-')
    if (!isValidPartialDate(date)) throw fail(t.badDate, year)
    return date
  }
  return { el, read, focus: () => year.focus() }
}

let hintSeq = 0

/**
 * A labelled input. A hint goes outside the label, so it's read as a description after the
 * label rather than as part of the input's name. Same layout: both are .field grids.
 */
function field(label: string | Node, input: HTMLElement, hint?: string) {
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input)
  if (!hint) return el
  const id = `field-hint-${++hintSeq}`
  input.setAttribute('aria-describedby', id)
  return h('div', { class: 'field' }, el, h('small', { id }, hint))
}

/** Person fields form. `read()` returns the fields, or throws a user-facing message (a FieldError where it can). */
export function personForm(initial: PersonFields = emptyFields()) {
  const text = (name: keyof PersonFields, extra: Record<string, string> = {}) =>
    h('input', { type: 'text', name, value: initial[name], autocomplete: 'off', ...extra })
  const nameZh = text('nameZh')
  const nameEn = text('nameEn')
  const otherNames = text('otherNames')
  const birthDate = partialDateField('birthDate', 'birthDate', initial.birthDate)
  const deathDate = partialDateField('deathDate', 'deathDate', initial.deathDate)
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
    h('div', { class: 'row' }, birthDate.el, deathDate.el),
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
      birthDate: birthDate.read(),
      deathDate: deathDate.read(),
      notes: notes.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim(),
      address: address.value.trim(),
      line: line.value.trim(),
      signal: signal.value.trim(),
    }
    if (!isValidEmail(fields.email)) throw fieldError(t.badEmail, email)
    const phoneE164 = normalizePhone(fields.phone)
    if (phoneE164 === null) throw fieldError(t.badPhone, phone)
    return { ...fields, phone: phoneE164 }
  }

  return { el, read, focus: () => nameZh.focus() }
}

/** Marriage dates form. `read()` returns the dates, or throws a FieldError. */
export function marriageForm(initial: Marriage) {
  const married = partialDateField('marriedDate', 'married', initial.married)
  const divorced = partialDateField('divorcedDate', 'divorced', initial.divorced)
  const el = h('div', { class: 'form' }, h('div', { class: 'row' }, married.el, divorced.el))
  const read = (): Marriage => ({ married: married.read(), divorced: divorced.read() })
  return { el, read, focus: married.focus }
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
  // Announces the number of matches once typing pauses.
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' })
  let announceTimer: ReturnType<typeof setTimeout> | undefined
  const announce = (text: string) => {
    clearTimeout(announceTimer)
    announceTimer = setTimeout(() => { live.textContent = text }, 500)
  }
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
    if (!q.trim()) { list.replaceChildren(...(opts.idle?.() ?? [])); announce(''); return }
    const results = searchPeople(people(), q).filter(p => p.id !== opts.exclude)
    announce(results.length === 0 ? t.noResults : results.length === 1 ? t.resultOne : tn('resultCount', results.length))
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
  return { el: h('div', { class: 'picker' }, opts.input ? null : input, list, live), input, list, live, refresh: update, selected }
}

/** A small header label for a section, with an optional compact action button on the right. */
export function sectionHead(title: Node, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, title), action ?? null)
}
