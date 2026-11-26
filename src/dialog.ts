import { h, standalone, wide } from './dom'
import { L, lang, pair, prefixed, t, tn, type Key } from './i18n'
import { UserError, errorText } from './errors'
import { type Marriage, type MarriageStatus, type Person, type PersonFields, emptyFields, isDeceased, isValidEmail, isValidPartialDate, marriageWithStatus, normalizePhone, searchPeople, displayName, type People } from './model'
import { personCard } from './cards'
import { parsePinyin } from './pinyin'
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
}

let dialogSeq = 0

/*
 * Back closes the top dialog in the installed app. Firefox for Android's web-app window doesn't
 * send Back to an open dialog (its browser tabs do); it goes back in history instead, and from the
 * app's first page that leaves an empty gray window. So while any dialog is open the app holds a
 * history entry of its own (same address, so no hashchange), and going back from it closes the top
 * dialog. The entry under it is stamped with the same number, which tells a Back from a hash
 * navigation made with a dialog open (a name in the change history), which also fires popstate.
 * One entry serves the whole stack, and letting it go waits a tick, so a menu item that closes the
 * menu sheet and opens a dialog keeps it. Browsers that close the dialog themselves on Back
 * (Chrome) end up in dismiss, which lets the entry go too.
 */
const dialogStack: (() => void)[] = []
let backHold = 0
let backHoldSeq = 0
let backRelease: ReturnType<typeof setTimeout> | undefined

function holdBack() {
  clearTimeout(backRelease)
  if (backHold || !standalone.matches) return
  backHold = ++backHoldSeq
  history.replaceState({ ...history.state, dialogBase: backHold }, '')
  history.pushState({ dialogHold: backHold }, '')
}

function releaseBack() {
  clearTimeout(backRelease)
  backRelease = setTimeout(() => {
    if (dialogStack.length || !backHold) return
    const held = backHold
    backHold = 0
    if (history.state?.dialogHold === held) history.back()
  })
}

window.addEventListener('popstate', () => {
  // Only going back to the entry under ours closes a dialog. A hash navigation buries ours, and
  // Back then returns to it before reaching the one under it.
  if (!backHold || history.state?.dialogBase !== backHold) return
  backHold = 0
  dialogStack.at(-1)?.()
  if (dialogStack.length) holdBack()
})

/**
 * Pages that rebuild their list (so a control that had focus is destroyed) mark what to refocus:
 * a control's `data-refocus` lists, space-separated and best first, the keys to try when it is gone,
 * and `data-refocus-key` names the controls that answer to a key. Keys are namespaced by page
 * ("missing:h1"), since the lookup spans the document. Focuses the earliest key's first rendered
 * match and returns whether anything took focus. Panes are hidden by CSS, so rendered is
 * checkVisibility() where it exists (jsdom lacks it, so there only [hidden] counts).
 */
export function focusRefocusTarget(keys: string[], root: ParentNode = document): boolean {
  const all = [...root.querySelectorAll<HTMLElement>('[data-refocus-key]')].filter(n => (n.checkVisibility ? n.checkVisibility() : !n.closest('[hidden]')))
  for (const k of keys) {
    const el = all.find(n => n.dataset.refocusKey === k)
    if (el) { el.focus({ preventScroll: true }); return true }
  }
  return false
}

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
  // The input named by the last validation error (see UserError), marked until the next attempt.
  let invalid: HTMLElement | undefined
  /** Empties the error line and un-marks the invalid field: no message outlives its cause. */
  const clearError = () => {
    error.textContent = ''
    if (invalid) {
      invalid.removeAttribute('aria-invalid')
      describedBy(invalid, errorId, false)
    }
    invalid = undefined
  }
  const button = (a: DialogAction) => {
    const btn = h('button', { type: 'button', class: [a.primary && 'primary', a.danger && 'danger'].filter(Boolean).join(' ') }, a.label)
    btn.addEventListener('click', async () => {
      clearError()
      btn.disabled = true
      try {
        if ((await a.run?.()) !== false) close()
      } catch (e) {
        error.textContent = errorText(e, pair('saveFailed'))
        invalid = (e as UserError).field
        if (invalid) {
          invalid.setAttribute('aria-invalid', 'true')
          describedBy(invalid, errorId, true)
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
  const heading = h('div', { class: 'dlg-title' },
    h('h2', { id: titleId }, title),
    opts.subtitle ? h('p', { class: 'dlg-sub', id: subId }, opts.subtitle) : null)
  // The subtitle says who the dialog is about ("Edit" alone doesn't), so it's read with the title.
  const dlg = h('dialog', {
    class: ['dlg', inHeader && 'with-save', opts.cls].filter(Boolean).join(' '),
    'aria-labelledby': titleId,
    'aria-describedby': opts.subtitle ? subId : undefined,
  },
    h('div', { class: 'dlg-head' }, ...(inHeader ? [x, heading, button(actions[0])] : [heading, x])),
    !inHeader && actions.length ? h('div', { class: 'dlg-actions' }, ...actions.map(button)) : null,
    h('div', { class: 'dlg-body' }, error, body),
  )
  // Return focus to what opened the dialog. Saving often re-renders the page, which replaces that
  // button, so then fall back to the dialog underneath or the person's name.
  const opener = document.activeElement as HTMLElement | null
  const close = () => {
    const i = dialogStack.indexOf(dismiss)
    if (i >= 0) dialogStack.splice(i, 1)
    releaseBack()
    dlg.close()
    // The toast may be inside this dialog (see toast); put it back before the dialog takes it along.
    const toastEl = dlg.querySelector('.toast')
    if (toastEl) document.body.append(toastEl)
    dlg.remove()
    if (opener && opener !== document.body && opener.isConnected && !opener.matches(':disabled')) { opener.focus({ preventScroll: true }); return }
    const under = [...document.querySelectorAll<HTMLElement>('dialog[open]')].at(-1)
    // A page that rebuilds its list names, in order, the controls to try when the opener is gone.
    const successor = !under && focusRefocusTarget(opener?.dataset?.refocus?.split(' ') ?? [])
    if (successor) return
    if (under) under.querySelector<HTMLElement>('.dlg-body :is(input, select, textarea), button')?.focus({ preventScroll: true })
    else focusPersonHeading()
  }
  // A new click or choice starts over, so an old message doesn't sit beside the result of a new
  // one. Capture phase: the button's own handler may show a new message, which must survive.
  // Typing into a text field doesn't clear a form's validation error; Save checks it again.
  const bodyEl = dlg.querySelector('.dlg-body')!
  bodyEl.addEventListener('click', e => { if ((e.target as Element).closest('button')) clearError() }, true)
  bodyEl.addEventListener('change', e => { if ((e.target as Element).matches('select')) clearError() })
  dlg.addEventListener('cancel', e => { e.preventDefault(); dismiss() })
  // Tapping the backdrop (outside the dialog box) dismisses it.
  dlg.addEventListener('click', e => { if (e.target === dlg) dismiss() })
  closePopover()
  document.body.append(dlg)
  dlg.showModal()
  dialogStack.push(dismiss)
  holdBack()
  return close
}

export function confirmDialog(message: string, label: string | Node, danger = false, subtitle?: string): Promise<boolean> {
  return new Promise(resolve => {
    openDialog(message, h('div'), [
      { label: L('cancel'), run: () => resolve(false) },
      { label, primary: !danger, danger, run: () => resolve(true) },
    ], { onDismiss: () => resolve(false), cls: 'confirm', subtitle })
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

/** A row of mutually exclusive buttons (aria-pressed). Clicking the one already pressed does nothing. */
export function segmented<V extends string>(label: string, options: [V, string | Node][], current: V, onPick: (v: V) => void): HTMLElement {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label })
  for (const [value, text] of options) {
    const btn = h('button', { type: 'button', 'aria-pressed': String(value === current), onclick: () => {
      if (value === current) return
      current = value
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
 * inert and under the backdrop, so a toast on the page could be neither seen nor heard. An error
 * goes into the top dialog's error line (an alert) instead; anything else (e.g. "Copied") moves the
 * toast element into that dialog, which puts it in the top layer, and back on the body afterwards.
 */
export function toast(message: string, { error: isError = false }: { error?: boolean } = {}) {
  const dlg = [...document.querySelectorAll('dialog[open]')].at(-1)
  const alert = dlg?.querySelector<HTMLElement>('.dlg-error')
  if (isError && alert) {
    alert.textContent = message
    alert.scrollIntoView?.({ block: 'nearest' })
    return
  }
  const el = mountToast()
  const home = dlg ?? document.body
  if (el.parentElement !== home) home.append(el)
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500)
}

export function copyText(text: string) {
  const failed = () => toast(t.copyFailed, { error: true })
  navigator.clipboard?.writeText(text).then(() => toast(t.copied), failed) ?? failed()
}

/** Adds or removes one id in an element's aria-describedby, keeping any others (e.g. a field hint). */
function describedBy(el: HTMLElement, id: string, on: boolean) {
  const ids = new Set((el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean))
  if (on) ids.add(id)
  else ids.delete(id)
  if (ids.size) el.setAttribute('aria-describedby', [...ids].join(' '))
  else el.removeAttribute('aria-describedby')
}

/**
 * A date that may be partial (YYYY, YYYY-MM or YYYY-MM-DD) as separate year, month and day
 * boxes. One box with dashes didn't work on iPhones, whose number pad has no "-".
 * `read()` returns the date with month and day zero-padded, or throws a UserError.
 */
function partialDateField(label: Key, name: string, initial: string) {
  const [y = '', m = '', d = ''] = initial ? initial.split('-') : []
  // Deliberately one language, not both: the three boxes are too narrow for a pair.
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
    const fail = (msg: Key, input: HTMLElement) => new UserError(prefixed(pair(label), pair(msg)), input)
    if (!yv && mv) throw fail('monthNeedsYear', year)
    if (!mv && dv) throw fail('dayNeedsMonth', month)
    if (yv && !/^\d{4}$/.test(yv)) throw fail('badYear', year)
    if (mv && !(/^\d{1,2}$/.test(mv) && +mv >= 1 && +mv <= 12)) throw fail('badMonth', month)
    if (dv && !(/^\d{1,2}$/.test(dv) && +dv >= 1 && +dv <= 31)) throw fail('badDay', day)
    const date = [yv, mv && mv.padStart(2, '0'), dv && dv.padStart(2, '0')].filter(Boolean).join('-')
    if (!isValidPartialDate(date)) throw fail('badDate', year)
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

/** Person fields form. `read()` returns the fields, or throws a UserError. */
export function personForm(initial: PersonFields = emptyFields()) {
  const text = (name: keyof PersonFields, extra: Record<string, string> = {}) =>
    h('input', { type: 'text', name, value: initial[name], autocomplete: 'off', ...extra })
  const nameZh = text('nameZh')
  const pinyin = text('pinyin', { lang: 'zh-Latn-pinyin', spellcheck: 'false', autocapitalize: 'words' })
  const nameEn = text('nameEn')
  const otherNames = text('otherNames')
  const birthDate = partialDateField('birthDate', 'birthDate', initial.birthDate)
  const deathDate = partialDateField('deathDate', 'deathDate', initial.deathDate)
  const deceased = h('input', { type: 'checkbox', name: 'deceased', checked: isDeceased(initial) })
  const deceasedBox = h('label', { class: 'checkbox' }, deceased, h('span', {}, L('deceased')))
  deathDate.el.addEventListener('input', () => {
    if ([...deathDate.el.querySelectorAll('input')].some(i => i.value.trim())) deceased.checked = true
  })
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

  const el = h('div', { class: 'form' },
    h('div', { class: 'row pair' }, field(L('nameZh'), nameZh), field(L('pinyin'), pinyin)),
    field(L('nameEn'), nameEn),
    field(L('otherNames'), otherNames, t.otherNamesHint),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, L('gender')), gender),
    h('div', { class: 'row' }, birthDate.el, h('div', { class: 'death-col' }, deathDate.el, deceasedBox)),
    h('div', { class: 'row' }, field(L('email'), email), field(L('phone'), phone, t.phoneHint)),
    field(L('line'), line, t.lineHint),
    field(L('signal'), signal, t.signalHint),
    field(L('address'), address),
    field(L('notes'), notes),
  )

  function read(): PersonFields {
    const py = parsePinyin(pinyin.value)
    if ('bad' in py) throw new UserError(prefixed(pair('badPinyin'), [py.bad, py.bad]), pinyin)
    const g = (gender.querySelector('input:checked') as HTMLInputElement | null)?.value ?? ''
    const fields: PersonFields = {
      nameZh: nameZh.value.trim(),
      pinyin: py.value,
      nameEn: nameEn.value.trim(),
      otherNames: otherNames.value.trim(),
      gender: g === 'M' || g === 'F' ? g : '',
      birthDate: birthDate.read(),
      deathDate: deathDate.read(),
      // A death date already implies deceased, so leave the flag as it was rather than log a change nobody made.
      deceased: deathDate.read() ? initial.deceased : deceased.checked ? 'yes' : '',
      notes: notes.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim(),
      address: address.value.trim(),
      line: line.value.trim(),
      signal: signal.value.trim(),
    }
    if (!isValidEmail(fields.email)) throw new UserError(pair('badEmail'), email)
    const phoneE164 = normalizePhone(fields.phone)
    if (phoneE164 === null) throw new UserError(pair('badPhone'), phone)
    return { ...fields, phone: phoneE164 }
  }

  /** Focuses `field`'s control (the year box for a date, the checked or first radio for gender), else the Chinese name. */
  function focus(field?: keyof PersonFields) {
    if (field === 'birthDate') birthDate.focus()
    else if (field === 'deathDate') deathDate.focus()
    else if (field === 'gender') (gender.querySelector<HTMLInputElement>('input:checked') ?? gender.querySelector<HTMLInputElement>('input'))?.focus()
    else if (field === 'nameEn') nameEn.focus()
    else nameZh.focus()
  }

  return { el, read, focus }
}

/**
 * A couple's status and marriage dates. Not married hides (and clears) the dates; typing a divorce
 * date switches to Divorced, and a marriage date alone to Married unless already Divorced.
 * `read()` returns the marriage, or throws a UserError.
 */
export function marriageForm(initial: Marriage) {
  const option = (value: MarriageStatus, label: string) => h('option', { value, selected: initial.status === value }, label)
  const status = h('select', { name: 'status' },
    option('', t.statusUnknown), option('married', t.statusMarried), option('divorced', t.statusDivorced),
    option('unmarried', t.statusUnmarried))
  const married = partialDateField('marriedDate', 'married', initial.married)
  const divorced = partialDateField('divorcedDate', 'divorced', initial.divorced)
  const dates = h('div', { class: 'row' }, married.el, divorced.el)
  const dateInputs = () => [...dates.querySelectorAll('input')]
  const sync = () => {
    dates.hidden = status.value === 'unmarried'
    if (dates.hidden) for (const i of dateInputs()) i.value = ''
  }
  status.addEventListener('change', sync)
  const filled = (el: HTMLElement) => [...el.querySelectorAll('input')].some(i => i.value.trim())
  dates.addEventListener('input', () => {
    if (filled(divorced.el)) status.value = 'divorced'
    else if (filled(married.el) && status.value !== 'divorced') status.value = 'married'
  })
  sync()
  const el = h('div', { class: 'form' }, field(L('marriageStatus'), status), dates)
  const read = (): Marriage => marriageWithStatus({
    married: married.read(), divorced: divorced.read(), status: status.value as MarriageStatus,
  })
  /** Focuses a date's year box, else the status. */
  function focus(field?: 'married' | 'divorced') {
    if (field === 'married') married.focus()
    else if (field === 'divorced') divorced.focus()
    else status.focus()
  }

  return { el, read, focus }
}

/**
 * Search box with a result list; calls onPick with the chosen person. `idle` fills the list while the box is empty.
 * With `selectable`, picking only highlights the person (read it back with `selected()`) and keeps the results.
 * Pass `input` to drive the list from an existing box (the top-bar search), and `find` to match
 * differently (the landing page lists every match, in rank order). Arrow keys move
 * from the box into the results and between them.
 */
export function personPicker(
  people: () => People,
  onPick: (p: Person) => void,
  opts: { placeholder?: string; exclude?: string; idle?: (card: (p: Person) => HTMLElement) => Node[]; selectable?: boolean; input?: HTMLInputElement; find?: (query: string) => Person[] } = {},
) {
  const find = opts.find ?? ((q: string) => searchPeople(people(), q))
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
    if (opts.selectable) { selectedId = p.id; input.value = displayName(p) }
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
    if (!q.trim()) { list.replaceChildren(...(opts.idle?.(card) ?? [])); announce(''); return }
    const results = find(q).filter(p => p.id !== opts.exclude)
    announce(results.length === 0 ? t.noResults : results.length === 1 ? t.resultOne : tn('resultCount', results.length))
    list.replaceChildren(results.length
      ? h('div', { class: 'cards' }, ...results.map(card))
      : h('p', { class: 'muted pad' }, t.noResults))
  }
  const results = () => [...list.querySelectorAll<HTMLButtonElement>('.pcard-main')]
  // In a selectable picker the chosen person's name goes in the box, and editing it drops the
  // choice (registered before update, which redraws the cards).
  if (opts.selectable) input.addEventListener('input', () => { selectedId = undefined })
  input.addEventListener('input', update)
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      const first = results()[0]
      if (first) { e.preventDefault(); first.focus() }
      return
    }
    if (e.key !== 'Enter') return
    const first = find(input.value).find(p => p.id !== opts.exclude)
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

/** A small header label for a section, with optional compact action buttons on the right. */
export function sectionHead(title: Node, ...actions: (HTMLElement | null | undefined)[]): HTMLElement {
  const shown = actions.filter((a): a is HTMLElement => !!a)
  return h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, title),
    shown.length > 1 ? h('div', { class: 'section-actions' }, ...shown) : shown[0] ?? null)
}
