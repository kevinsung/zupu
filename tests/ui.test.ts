// Smoke test of the whole UI talking to the real Worker + local D1: login, chart, panel, editing, history.
// Runs in the node environment and installs jsdom globals by hand *after* starting the Worker,
// because wrangler/esbuild refuse to load inside vitest's jsdom environment.
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { populateGlobal } from 'vitest/runtime'
import { emptyFields } from '../src/model'
import { startWorker } from './worker-env'

const person = (id: string, extra: Record<string, unknown> = {}) =>
  ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, order: 0, ...extra })
const seed = [
  person('gp', { nameZh: '祖父', gender: 'M', spouses: ['gm'] }),
  person('gm', { nameZh: '祖母', gender: 'F', spouses: ['gp'], order: 1 }),
  person('a', { nameZh: '甲', nameEn: 'Alice', gender: 'F', parents: ['gp', 'gm'], birthDate: '1960', order: 2 }),
  person('b', { nameZh: '乙', gender: 'M', parents: ['gp', 'gm'], order: 3 }),
  // A half sibling of 甲 and 乙 through 祖父; their mother isn't recorded as his spouse.
  person('gm2', { nameZh: '繼祖母', gender: 'F', order: 4 }),
  person('c', { nameZh: '丙', gender: 'M', parents: ['gp', 'gm2'], birthDate: '1970', order: 5 }),
]

let w: Awaited<ReturnType<typeof startWorker>>
afterAll(() => w?.dispose())

const tick = (ms = 50) => new Promise(r => setTimeout(r, ms))
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const topDialog = () => [...document.querySelectorAll<HTMLElement>('dialog[open]')].at(-1)!
/** Menus open next to their button on wide screens (jsdom counts as wide). */
const popover = () => $('.popover')
const buttonWith = (text: string, root: ParentNode = document) =>
  [...root.querySelectorAll('button')].find(b => b.textContent!.includes(text))!
/** Waits for a dialog to close after Save: saving is several round trips to the Worker, slower on CI. */
const closed = (dlg: Element) => vi.waitFor(() => {
  if (dlg.isConnected) throw new Error(`dialog still open; error: "${dlg.querySelector('.dlg-error')?.textContent ?? ''}"`)
}, { timeout: 5000, interval: 20 })

beforeAll(async () => {
  w = await startWorker('dev')
  await w.post('/api/login', { password: 'dev' })
  await w.post('/api/commit', { ops: seed.map(p => ({ type: 'set', person: p })), editor: 'import', summary: 'seed' })
  await w.post('/api/logout', {})
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  populateGlobal(globalThis, dom.window, { bindFunctions: true })
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => w.call(path, init))
  // jsdom lacks these; family-chart and <dialog> need them.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  Object.assign(SVGElement.prototype, { getBBox: () => ({ x: 0, y: 0, width: 100, height: 50 }) })
  vi.stubGlobal('DOMMatrix', class { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; isIdentity = true })
  await import('../src/main')
  await tick(300)
}, 60_000)

describe('app', () => {
  it('rejects a wrong password, then signs in', async () => {
    $<HTMLInputElement>('input[type=password]').value = 'wrong'
    $<HTMLFormElement>('form.login').requestSubmit()
    await tick()
    expect($('.login .dlg-error').textContent).toContain('Wrong password')
    $<HTMLInputElement>('input[type=password]').value = 'dev'
    $<HTMLFormElement>('form.login').requestSubmit()
    await tick(300)
    expect(document.querySelector('header')).toBeTruthy()
  })

  it('starts at a root ancestor and renders cards', async () => {
    expect($('#person h1').textContent).toBe('祖父')
    expect(location.hash).toMatch(/^#\/p\//)
    expect(document.querySelectorAll('.ft-card').length).toBeGreaterThanOrEqual(4)
    // Landmarks are named, and the two navs differently.
    expect($('.tree-pane').getAttribute('aria-label')).toBe('族譜 / Tree')
    expect($('.person-pane').getAttribute('aria-label')).toBe('人物 / Person')
    const navs = [...document.querySelectorAll('nav')].map(n => n.getAttribute('aria-label'))
    expect(navs.length).toBe(2)
    expect(new Set(navs).size).toBe(2)
    expect(navs.every(Boolean)).toBe(true)
  })

  it("makes the tree one tab stop, on the selected person's card", async () => {
    const stops = document.querySelectorAll<HTMLElement>('.ft-card[tabindex="0"]')
    expect(stops.length).toBe(1)
    expect(location.hash).toBe(`#/p/${stops[0].dataset.id}`)
    expect(stops[0].getAttribute('aria-label')).toBe('祖父, 男 / male')
    expect(stops[0].getAttribute('aria-current')).toBe('true')
    expect(document.querySelectorAll('.ft-card[tabindex="-1"]').length).toBeGreaterThanOrEqual(3)
    expect(document.getElementById(stops[0].getAttribute('aria-describedby')!)!.textContent).toContain('Arrow keys')
  })

  it('navigates via search, which lists family lines and recent people', async () => {
    const input = $<HTMLInputElement>('.search-trigger')
    const pop = $('.search-pop')
    expect(pop.hidden).toBe(true)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(pop.hidden).toBe(false)
    expect([...pop.querySelectorAll('.pcard-name')].map(e => e.textContent)).toContain('祖父 & 祖母')
    expect(input.hasAttribute('role')).toBe(false)
    expect(input.getAttribute('aria-keyshortcuts')).toBe('/')
    input.value = 'alice'
    input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect($('.search-box [aria-live]').textContent).toBe('1 筆結果 / 1 result'))
    buttonWith('甲', pop).click()
    await tick(100)
    expect(pop.hidden).toBe(true)
    expect($('#person h1').textContent).toBe('甲')
    expect($('#person .pv-parents').textContent).toContain('祖父')
    // This person appears among their siblings, in birth order, and isn't a link.
    expect($('#person .pv-siblings').textContent).toContain('乙')
    expect($('#person .pv-siblings .pcard.self').textContent).toContain('甲')
    // Full and half siblings get separate sections.
    expect($('#person .pv-siblings .section-title').textContent).toContain('同父同母')
    expect($('#person .pv-siblings').textContent).not.toContain('丙')
    expect($('#person .pv-half-paternal .section-title').textContent).toContain('同父異母')
    expect($('#person .pv-half-paternal').textContent).toContain('丙')
    expect(document.querySelector('#person .pv-half-maternal')).toBeNull()
    input.click()
    expect(pop.hidden).toBe(false)
    expect(pop.textContent).toContain('祖父')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(pop.hidden).toBe(true)
  })

  it('adds a spouse, asking for the editor name first', async () => {
    buttonWith('新增配偶').click()
    const dlg = $('dialog[open]')
    expect(dlg.querySelector<HTMLInputElement>('input[name=gender][value=M]')!.checked).toBe(true)
    dlg.querySelector<HTMLInputElement>('input[name=nameZh]')!.value = '丈夫'
    buttonWith('儲存', dlg).click()
    await tick()
    const nameDlg = [...document.querySelectorAll('dialog[open]')].at(-1)!
    nameDlg.querySelector('input')!.value = 'Tester'
    buttonWith('儲存', nameDlg).click()
    await closed(nameDlg)
    await closed(dlg)
    expect(document.querySelectorAll('dialog[open]').length).toBe(0)
    expect($('#person').textContent).toContain('丈夫')
    expect(document.querySelector('header')!.textContent).toContain('Tester')
  })

  it('rejects bad dates in the edit form', async () => {
    const edit = buttonWith('編輯', $('#person'))
    edit.focus()
    edit.click()
    const dlg = $('dialog[open]')
    expect(dlg.querySelector('.dlg-sub')!.textContent).toBe('甲')
    // The dialog is described by the subtitle, so "Edit" is announced with whom it's about.
    expect(document.getElementById(dlg.getAttribute('aria-describedby')!)).toBe(dlg.querySelector('.dlg-sub'))
    const year = dlg.querySelector<HTMLInputElement>('input[name=birthDate-y]')!
    const month = dlg.querySelector<HTMLInputElement>('input[name=birthDate-m]')!
    expect(year.value).toBe('1960')
    expect(year.getAttribute('inputmode')).toBe('numeric')
    // A month needs a year; the bad box is marked and focused.
    year.value = ''
    month.value = '3'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Birth date: 填了月份也請填年份 / enter the year too')
    expect(year.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(year)
    // The bad box is described by the error message.
    expect(document.getElementById(year.getAttribute('aria-describedby')!)).toBe(dlg.querySelector('.dlg-error'))
    year.value = '60'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('4 digits')
    month.value = '13'
    year.value = '1960'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('1 to 12')
    expect(year.hasAttribute('aria-invalid')).toBe(false)
    expect(year.hasAttribute('aria-describedby')).toBe(false)
    expect(month.getAttribute('aria-invalid')).toBe('true')
    month.value = '3'
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    expect($('#person .pv-dates').textContent).toContain('1960-03')
    // Gender is shown as a word, not only by color.
    expect($('#person .pv-dates').textContent).toContain('女 / female')
    // Saving re-rendered the page and its Edit button, so focus goes to the person's name.
    expect(edit.isConnected).toBe(false)
    expect(document.activeElement).toBe($('#person h1'))
  })

  it('logs changes in history and can revert', async () => {
    buttonWith('修改紀錄').click()
    await tick(300)
    const dlg = $('dialog[open]')
    const items = dlg.querySelectorAll('.history-item')
    expect(items.length).toBe(3) // seed + spouse + edit
    expect(items[0].textContent).toContain('Tester')
    expect(items[0].textContent).toContain('1960 → 1960-03')
    const ids = [...items].map(li => (li as HTMLElement).dataset.id)
    expect(new Set(ids).size).toBe(3)
    // Open two items' details and revert from the first.
    items[0].querySelector('details')!.open = true
    items[1].querySelector('details')!.open = true
    const revert = buttonWith('還原', items[0])
    revert.focus()
    revert.click()
    await tick()
    buttonWith('還原', [...document.querySelectorAll('dialog[open]')].at(-1)!).click()
    await tick(300)
    expect($('#person .pv-dates').textContent).not.toContain('1960-03')
    // The revert added a change and rebuilt the list, keeping open details and the focused button.
    const after = [...dlg.querySelectorAll<HTMLElement>('.history-item')]
    expect(after.length).toBe(4)
    expect(revert.isConnected).toBe(false)
    const byId = (id: string | undefined) => after.find(li => li.dataset.id === id)!
    expect(byId(ids[0]).querySelector('details')!.open).toBe(true)
    expect(byId(ids[1]).querySelector('details')!.open).toBe(true)
    expect(byId(ids[2]).querySelector('details')!.open).toBe(false)
    expect(after[0].querySelector('details')!.open).toBe(false)
    expect(document.activeElement).toBe(buttonWith('還原', byId(ids[0])))
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('closes a menu when focus leaves it', async () => {
    const more = $<HTMLButtonElement>('#person .pv-actions .more')
    more.click()
    const items = [...popover().querySelectorAll<HTMLButtonElement>('.menu-item')]
    expect(document.activeElement).toBe(items[0])
    // Moving within the menu keeps it open.
    items[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: items[1] }))
    expect(document.querySelector('.popover')).toBeTruthy()
    // A second click on its button closes it, even where (Safari) the press blurs the menu to <body>.
    more.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    items[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    expect(document.querySelector('.popover')).toBeTruthy()
    more.dispatchEvent(new Event('pointerup', { bubbles: true }))
    more.click()
    expect(document.querySelector('.popover')).toBeNull()
    more.click()
    items.splice(0, items.length, ...popover().querySelectorAll<HTMLButtonElement>('.menu-item'))
    // Tabbing out of it (here, to the name) closes it and returns to its button.
    items[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: $('#person h1') }))
    expect(document.querySelector('.popover')).toBeNull()
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(more)
  })

  it("shows one person's history from the more menu", async () => {
    const dialogs = document.querySelectorAll('dialog[open]').length
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    // 甲 has two parents, so Add parent is unavailable but still reachable, with the reason.
    const addParent = buttonWith('新增父母', popover())
    expect(addParent.disabled).toBe(false)
    expect(addParent.getAttribute('aria-disabled')).toBe('true')
    expect(addParent.querySelector('small')!.textContent).toContain('Already has two parents')
    expect(buttonWith('新增配偶', popover()).hasAttribute('aria-disabled')).toBe(false)
    addParent.click()
    expect(document.querySelector('.popover')).toBeTruthy()
    expect(document.querySelectorAll('dialog[open]').length).toBe(dialogs)
    buttonWith('此人的修改紀錄', popover()).click()
    await tick(300)
    const dlg = topDialog()
    expect(dlg.querySelector('.dlg-sub')!.textContent).toBe('甲')
    const items = [...dlg.querySelectorAll('.history-item')].map(li => li.textContent)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(text => !text!.includes('祖父 → '))).toBe(true)
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('shows a failure inside the open dialog, not behind it', async () => {
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('移除關係', popover()).click()
    const dlg = topDialog()
    const row = [...dlg.querySelectorAll('.pcard')].find(c => c.textContent!.includes('丈夫'))!
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => path === '/api/commit'
      ? Promise.resolve(new Response(JSON.stringify({ error: 'offline' }), { status: 500 }))
      : w.call(path, init))
    try {
      buttonWith('移除', row).click()
      await tick()
      buttonWith('移除', topDialog()).click()
      await vi.waitFor(() => expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Save failed: offline'))
    } finally {
      vi.stubGlobal('fetch', (path: string, init?: RequestInit) => w.call(path, init))
    }
    expect(topDialog()).toBe(dlg)
    expect(dlg.querySelector('.dlg-error')!.getAttribute('role')).toBe('alert')
    expect(document.querySelector('.toast')!.classList.contains('show')).toBe(false)
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
    expect($('#person .pv-families').textContent).toContain('丈夫')
  })

  it('removes a relationship from the more menu', async () => {
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('移除關係', popover()).click()
    expect(document.querySelector('.popover')).toBeNull()
    const dlg = topDialog()
    expect(dlg.textContent).toContain('丈夫')
    const row = [...dlg.querySelectorAll('.pcard')].find(c => c.textContent!.includes('丈夫'))!
    // The row's only control is its Remove button, which says whom it removes; the name isn't a dead button.
    expect(row.querySelectorAll('button').length).toBe(1)
    expect(row.querySelector('.pcard-main')!.tagName).toBe('DIV')
    expect(row.querySelector('button')!.getAttribute('aria-label')).toBe('移除 / Remove 丈夫')
    buttonWith('移除', row).click()
    await tick()
    buttonWith('移除', topDialog()).click()
    await closed(dlg)
    expect($('#person .pv-families').textContent).not.toContain('丈夫')
  })

  it('links an existing person only after Save', async () => {
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('連結現有的人', popover()).click()
    const dlg = topDialog()
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Choose a person')
    const input = dlg.querySelector<HTMLInputElement>('input[type=search]')!
    input.value = '丈夫'
    input.dispatchEvent(new Event('input'))
    buttonWith('丈夫', dlg).click()
    await tick(100)
    expect(dlg.isConnected).toBe(true)
    expect(dlg.querySelector('.pcard.selected')!.textContent).toContain('丈夫')
    expect($('#person .pv-families').textContent).not.toContain('丈夫')
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    expect($('#person .pv-families').textContent).toContain('丈夫')
  })

  it('adds marriage dates under a spouse and shows them in history', async () => {
    const families = () => $('#person .pv-families')
    buttonWith('新增結婚日期', families()).click()
    const dlg = topDialog()
    dlg.querySelector<HTMLInputElement>('input[name=married-y]')!.value = '85'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Marriage date: 年份應為四位數字')
    dlg.querySelector<HTMLInputElement>('input[name=married-y]')!.value = '1985'
    dlg.querySelector<HTMLInputElement>('input[name=married-m]')!.value = '10'
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    expect(families().querySelector('.marriage')!.textContent).toContain('結婚 / Married 1985-10')
    buttonWith('修改紀錄').click()
    await tick(300)
    expect(topDialog().querySelector('.history-item')!.textContent).toContain('婚姻 / Marriage (丈夫): —')
    topDialog().querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('edits contact info and shows email and phone as links', async () => {
    buttonWith('編輯', $('#person')).click()
    const dlg = [...document.querySelectorAll<HTMLElement>('dialog[open]')].at(-1)!
    const set = (name: string, value: string) => { dlg.querySelector<HTMLInputElement>(`[name=${name}]`)!.value = value }
    // Hints are descriptions, not part of the label.
    const phone = dlg.querySelector<HTMLInputElement>('[name=phone]')!
    expect(document.getElementById(phone.getAttribute('aria-describedby')!)!.textContent).toContain('country code')
    expect(phone.closest('label')!.textContent).not.toContain('country code')
    // No contact info yet, so the Contact section starts collapsed.
    const contactGroup = dlg.querySelector('details')!
    expect(contactGroup.open).toBe(false)
    set('email', 'alice@')
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Invalid email')
    expect(dlg.querySelector('[name=email]')!.getAttribute('aria-invalid')).toBe('true')
    // The error opened the section so the bad input could take focus.
    expect(contactGroup.open).toBe(true)
    expect(document.activeElement).toBe(dlg.querySelector('[name=email]'))
    set('phone', '201-555-0123')
    set('email', 'alice@example.com')
    buttonWith('儲存', dlg).click()
    await tick()
    // The phone hint and the error both describe it; the email is back to normal.
    expect(phone.getAttribute('aria-describedby')!.split(' ').length).toBe(2)
    expect(dlg.querySelector('[name=email]')!.hasAttribute('aria-describedby')).toBe(false)
    set('email', 'alice@example.com')
    set('phone', '201-555-0123')
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Invalid phone')
    set('phone', '+1 (201) 555-0123')
    set('line', 'alice_line')
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    const contact = $('#person .contact')
    expect(contact.querySelector('a[href="mailto:alice@example.com"]')).toBeTruthy()
    expect(contact.querySelector('a[href="tel:+12015550123"]')!.textContent).toBe('+1 201 555 0123')
    expect(contact.textContent).toContain('alice_line')
    // Each Copy button says what it copies.
    const copies = [...contact.querySelectorAll('button')].filter(b => b.textContent!.includes('複製')).map(b => b.getAttribute('aria-label'))
    expect(copies).toEqual(['複製 / Copy 電子郵件 / Email', '複製 / Copy LINE'])
  })

  it('adds a half sibling by choosing the parents', async () => {
    buttonWith('新增', $('#person .pv-siblings')).click()
    const dlg = topDialog()
    const select = dlg.querySelector<HTMLSelectElement>('select')!
    const options = [...select.options]
    expect(options.map(o => o.value)).toEqual(['gp,gm', 'gp', 'gm'])
    expect(options[0].textContent).toBe('祖父 & 祖母')
    expect(options[1].textContent).toContain('同父異母')
    select.value = 'gp'
    dlg.querySelector<HTMLInputElement>('input[name=nameZh]')!.value = '丁'
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    expect($('#person .pv-siblings').textContent).not.toContain('丁')
    const card = [...document.querySelectorAll('#person .pv-half-paternal .pcard')].find(c => c.textContent!.includes('丁'))!
    const main = card.querySelector<HTMLElement>('.pcard-main')!
    main.focus()
    main.click()
    await tick(100)
    expect($('#person h1').textContent).toBe('丁')
    expect(document.activeElement).toBe($('#person h1'))
    expect($('#person .pv-parents').textContent).toContain('祖父')
    expect($('#person .pv-parents').textContent).not.toContain('祖母')
  })

  it('switches the theme from the settings menu and remembers it', async () => {
    const settings = $<HTMLButtonElement>('.settings-btn')
    settings.click()
    buttonWith('深色', popover()).click()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('ft-theme')).toBe('dark')
    settings.click() // a second click closes the menu
    expect(document.querySelector('.popover')).toBeNull()
    settings.click()
    expect(buttonWith('深色', popover()).getAttribute('aria-pressed')).toBe('true')
    buttonWith('跟隨系統', popover()).click()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('ft-theme')).toBeNull()
    // Language names are marked with their language.
    expect(buttonWith('English', popover()).querySelector('[lang=en]')).toBeTruthy()
    expect(buttonWith('中文', popover()).querySelector('[lang=zh-Hant]')).toBeTruthy()
    settings.click()
  })

  it("moves focus to the tree after Show in tree on a phone", async () => {
    // jsdom has no matchMedia, so `wide` is a plain object we can flip; the page re-renders on navigation.
    // (Imported here: the module needs the jsdom globals.)
    const layout = (await import('../src/dom')).wide as { matches: boolean }
    layout.matches = false
    try {
      location.hash = '#/p/b'
      await vi.waitFor(() => expect($('#person h1').textContent).toBe('乙'))
      const more = $<HTMLButtonElement>('#person .pv-actions .more')
      more.focus()
      more.click()
      // Phones get the menu as a sheet.
      buttonWith('在族譜中查看', topDialog()).click()
      expect(document.querySelectorAll('dialog[open]').length).toBe(0)
      const card = document.activeElement as HTMLElement
      expect(card.matches('.ft-card')).toBe(true)
      expect(card.dataset.id).toBe('b')
      expect(card.tabIndex).toBe(0)
    } finally {
      layout.matches = true
    }
  })
})
