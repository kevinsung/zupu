// Smoke test of the whole UI talking to the real Worker + local D1: login, chart, panel, editing, history.
// Runs in the node environment and installs jsdom globals by hand *after* starting the Worker,
// because wrangler/esbuild refuse to load inside vitest's jsdom environment.
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { populateGlobal } from 'vitest/runtime'
import { emptyFields } from '../src/model'
import { startWorker } from './worker-env'

const person = (id: string, extra: Record<string, unknown> = {}) =>
  ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, parentKinds: {}, order: 0, ...extra })
const seed = [
  person('gp', { nameZh: '祖父', gender: 'M', spouses: ['gm'] }),
  person('gm', { nameZh: '祖母', gender: 'F', spouses: ['gp'], order: 1 }),
  person('a', { nameZh: '甲', nameEn: 'Alice', gender: 'F', parents: ['gp', 'gm'], birthDate: '1960', order: 2 }),
  person('b', { nameZh: '乙', gender: 'M', parents: ['gp', 'gm'], order: 3 }),
  // A half sibling of 甲 and 乙 through 祖父; his mother is a co-parent of 祖父, not recorded as his spouse.
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
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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
    // No connection: the browser's "Failed to fetch" is worded for people.
    const reachable = globalThis.fetch
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    $<HTMLFormElement>('form.login').requestSubmit()
    await tick()
    expect($('.login .dlg-error').textContent).toContain("Couldn't connect")
    expect($('.login .dlg-error').textContent).not.toContain('Failed to fetch')
    vi.stubGlobal('fetch', reachable)
    $<HTMLInputElement>('input[type=password]').value = 'dev'
    const fetched: string[] = []
    const online = globalThis.fetch
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => (fetched.push(`${init?.method ?? 'GET'} ${path}`), online(path, init)))
    $<HTMLFormElement>('form.login').requestSubmit()
    await tick(300)
    vi.stubGlobal('fetch', online)
    expect(document.querySelector('header')).toBeTruthy()
    // The session is asked again after signing in, so the service worker's offline copy says signed in.
    expect(fetched.slice(0, 2)).toEqual(['POST /api/login', 'GET /api/session'])
  })

  it('starts on the landing list, with no one selected', async () => {
    const names = () => [...document.querySelectorAll('.home-pane .pcard-name')].map(e => e.textContent)
    // Most generations and descendants first; the childless by birth, then entry order.
    expect(names()).toEqual(['祖父', '祖母', '繼祖母', '甲', '乙', '丙'])
    expect($('main').dataset.view).toBe('home')
    expect(location.hash).toBe('')
    expect(document.title).toBe('族譜 / Family Tree')
    expect(document.querySelector('.ft-card')).toBeNull()
    expect($('.home-pane').getAttribute('aria-label')).toBe('搜尋 / Search')
    expect($('.topbar .brand').getAttribute('aria-current')).toBe('page')
    // On wide screens (jsdom counts as wide) the list's filter is the top bar's only search box.
    const boxes = [...document.querySelectorAll<HTMLElement>('.topbar .search-box')].filter(b => !b.hidden)
    expect(boxes.length).toBe(1)
    expect($('.home-head').hidden).toBe(true)
    expect(document.querySelector('.search-pop')!.closest('.search-box')!.hasAttribute('hidden')).toBe(true)
    const filter = boxes[0].querySelector('input')!
    filter.value = 'alice'
    filter.dispatchEvent(new Event('input'))
    expect(names()).toEqual(['甲'])
    filter.value = ''
    filter.dispatchEvent(new Event('input'))
    expect(names()).toEqual(['祖父', '祖母', '繼祖母', '甲', '乙', '丙'])
  })

  it('opens a person picked from the list and renders cards', async () => {
    buttonWith('祖父', $('.home-pane')).click()
    await tick(100)
    expect(location.hash).toBe('#/p/gp')
    expect($('main').dataset.view).not.toBe('home')
    // Off the list, the top bar's search drops its results down again.
    expect($('.search-pop').closest('.search-box')!.hasAttribute('hidden')).toBe(false)
    expect($('.home-head').contains($('.home-filter'))).toBe(true)
    expect($('#person h1').textContent).toBe('祖父')
    expect(document.activeElement).toBe($('#person h1'))
    expect(document.title).toBe('祖父 — 族譜 / Family Tree')
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

  it('navigates via search, which lists recent people and everyone', async () => {
    const input = $<HTMLInputElement>('.search-trigger')
    const pop = $('.search-pop')
    expect(pop.hidden).toBe(true)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(pop.hidden).toBe(false)
    expect(pop.querySelector('.section-title')!.textContent).toContain('Everyone')
    expect([...pop.querySelectorAll('.pcard-name')].map(e => e.textContent)).toContain('祖母')
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

  it('goes back to the list from the brand, and from an unknown person', async () => {
    const brand = $<HTMLAnchorElement>('.topbar a.brand')
    expect(brand.getAttribute('href')).toBe('#/')
    expect(brand.hasAttribute('aria-current')).toBe(false)
    location.hash = '#/'
    await vi.waitFor(() => expect($('main').dataset.view).toBe('home'))
    expect(document.title).toBe('族譜 / Family Tree')
    // Recently viewed comes first while the filter is empty.
    expect($('.home-pane .section-title').textContent).toContain('Recently viewed')
    expect($('.home-pane section .pcard-name').textContent).toBe('甲')
    location.hash = '#/p/x'
    await tick(100)
    expect(location.hash).toBe('#/')
    expect($('main').dataset.view).toBe('home')
    // The last person picked is still selected, and comes back.
    expect($('#person h1').textContent).toBe('甲')
    location.hash = '#/p/a'
    await vi.waitFor(() => expect($('main').dataset.view).not.toBe('home'))
    expect($('#person h1').textContent).toBe('甲')
  })

  it('shows the family stats at #/stats and returns to them with Back', async () => {
    location.hash = '#/stats'
    await vi.waitFor(() => expect($('main').dataset.view).toBe('stats'))
    expect(document.title).toBe('統計 / Stats — 族譜 / Family Tree')
    expect($('.stats-pane h1').textContent).toContain('族譜統計')
    expect([...document.querySelectorAll('.tile-value')].map(e => e.textContent)).toEqual(['6', '2', '1960–1970', '6'])
    expect($('.topnav [aria-current="page"]').textContent).toContain('統計')
    expect($('.tab[aria-current="page"]').dataset.tab).toBe('stats')
    // Tapping a bar lists its people; tapping a person opens them.
    const bar = $('.stat-chart .hbar')
    bar.click()
    expect(bar.getAttribute('aria-expanded')).toBe('true')
    expect($('.stat-list .pcard-name').textContent).toBe('祖父')
    bar.click()
    expect($('.stat-list').hidden).toBe(true)
    bar.click()
    buttonWith('祖父', $('.stat-list')).click()
    await vi.waitFor(() => expect(location.hash).toBe('#/p/gp'))
    await vi.waitFor(() => expect($('main').dataset.view).not.toBe('stats'))
    history.back()
    await vi.waitFor(() => expect($('main').dataset.view).toBe('stats'))
    location.hash = '#/p/a'
    await vi.waitFor(() => expect($('main').dataset.view).not.toBe('stats'))
  })

  it('adds a spouse, asking for the editor name first', async () => {
    buttonWith('新增伴侶').click()
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
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('出生日期：請一併填寫年份 / Birth date: enter the year too')
    // A validation error isn't a failed save.
    expect(dlg.querySelector('.dlg-error')!.textContent).not.toContain('儲存失敗')
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
    expect(buttonWith('新增伴侶', popover()).hasAttribute('aria-disabled')).toBe(false)
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
      await vi.waitFor(() => expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Save failed: Server error (offline)'))
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
    // People are suggested before anything is typed, leaving out the person being linked to.
    const self = dlg.querySelector('.dlg-sub')!.textContent!
    const input = dlg.querySelector<HTMLInputElement>('input[type=search]')!
    const names = () => [...dlg.querySelectorAll('.pcard-name')].map(n => n.textContent)
    expect(names().length).toBeGreaterThan(1)
    expect(names()).not.toContain(self)
    input.value = '丈夫'
    input.dispatchEvent(new Event('input'))
    buttonWith('丈夫', dlg).click()
    await tick(100)
    // The choice goes in the box and stays marked in the list.
    expect(dlg.isConnected).toBe(true)
    expect(input.value).toBe('丈夫')
    expect(dlg.querySelector('.pcard.selected')!.textContent).toContain('丈夫')
    expect($('#person .pv-families').textContent).not.toContain('丈夫')
    // Editing the name drops the choice.
    input.value = '丈'
    input.dispatchEvent(new Event('input'))
    expect(dlg.querySelector('.pcard.selected')).toBeNull()
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Choose a person')
    buttonWith('丈夫', dlg).click()
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    expect($('#person .pv-families').textContent).toContain('丈夫')
  })

  it('adds marriage dates under a spouse and shows them in history', async () => {
    const families = () => $('#person .pv-families')
    buttonWith('新增婚姻資料', families()).click()
    const dlg = topDialog()
    dlg.querySelector<HTMLInputElement>('input[name=married-y]')!.value = '85'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('結婚日期：年份應為四位數字 / Marriage date: the year must have 4 digits')
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

  it('marks a person deceased without a death date', async () => {
    buttonWith('編輯', $('#person')).click()
    const dlg = topDialog()
    const box = dlg.querySelector<HTMLInputElement>('input[name=deceased]')!
    expect(box.type).toBe('checkbox')
    expect(box.closest('label')!.textContent).toContain('Deceased')
    expect(box.checked).toBe(false)
    // Typing a death year ticks it; clearing the year leaves it ticked.
    const deathYear = dlg.querySelector<HTMLInputElement>('input[name=deathDate-y]')!
    deathYear.value = '2000'
    deathYear.dispatchEvent(new Event('input', { bubbles: true }))
    expect(box.checked).toBe(true)
    deathYear.value = ''
    box.checked = true
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    const dates = $('#person .pv-dates').textContent!
    expect(dates).toContain('1960 – ?')
    expect(dates).not.toMatch(/歲|aged|age/i)
    buttonWith('修改紀錄').click()
    await tick(300)
    expect(topDialog().querySelector('.history-item')!.textContent).toContain('已故 / Deceased: — → 已故 / Deceased')
    topDialog().querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('shows deceased on cards, with years before other names', async () => {
    location.hash = '#/p/b'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('乙'))
    buttonWith('編輯', $('#person')).click()
    const dlg = topDialog()
    dlg.querySelector<HTMLInputElement>('input[name=deceased]')!.checked = true
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    // 乙 has no dates, so the cards say 已故 / Deceased; 甲's years come before her English name.
    const sub = (id: string) => document.querySelector(`#person .pcard[data-id="${id}"] .pcard-sub`)?.textContent
    expect(sub('a')).toBe('1960–? · Alice')
    await vi.waitFor(() => expect($('.ft-card[data-id="b"] .ft-years').textContent).toBe('已故 / Deceased'))
    location.hash = '#/p/a'
    await vi.waitFor(() => expect(sub('b')).toBe('已故 / Deceased'))
    expect(document.querySelector('#person .pcard.self .pcard-sub')!.textContent).toBe('本人 / This person · 1960–? · Alice')
  })

  it('opens ticked for a death date and leaves the deceased flag alone unless changed', async () => {
    const { personForm } = await import('../src/dialog')
    const box = (form: ReturnType<typeof personForm>) => form.el.querySelector<HTMLInputElement>('input[name=deceased]')!
    // Records from before the flag existed have a death date and deceased ''.
    const legacy = personForm({ ...emptyFields(), deathDate: '1950' })
    expect(box(legacy).checked).toBe(true)
    expect(legacy.read().deceased).toBe('')
    // Clearing the date falls back to the checkbox.
    legacy.el.querySelector<HTMLInputElement>('input[name=deathDate-y]')!.value = ''
    expect(legacy.read().deceased).toBe('yes')
    box(legacy).checked = false
    expect(legacy.read().deceased).toBe('')
    expect(box(personForm({ ...emptyFields(), deceased: 'yes' })).checked).toBe(true)
    expect(box(personForm()).checked).toBe(false)
  })

  it('edits contact info and shows email and phone as links', async () => {
    buttonWith('編輯', $('#person')).click()
    const dlg = [...document.querySelectorAll<HTMLElement>('dialog[open]')].at(-1)!
    const set = (name: string, value: string) => { dlg.querySelector<HTMLInputElement>(`[name=${name}]`)!.value = value }
    // Hints are descriptions, not part of the label.
    const phone = dlg.querySelector<HTMLInputElement>('[name=phone]')!
    expect(document.getElementById(phone.getAttribute('aria-describedby')!)!.textContent).toContain('country code')
    expect(phone.closest('label')!.textContent).not.toContain('country code')
    set('email', 'alice@')
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Invalid email')
    expect(dlg.querySelector('[name=email]')!.getAttribute('aria-invalid')).toBe('true')
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

  it('checks pinyin, turns tone numbers into marks and shows it under the name', async () => {
    expect(document.querySelector('#person .pv-pinyin')).toBeNull()
    buttonWith('編輯', $('#person')).click()
    const dlg = topDialog()
    const input = dlg.querySelector<HTMLInputElement>('[name=pinyin]')!
    input.value = 'Jia3 xbio'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('不是有效的拼音：xbio / Not valid pinyin: xbio')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input)
    input.value = 'jia3'
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    const line = $('#person .pv-pinyin')
    expect(line.textContent).toBe('Jiǎ')
    expect(line.getAttribute('lang')).toBe('zh-Latn-pinyin')
    // Only on the person page: cards keep their subtitles.
    expect(document.querySelector('.pcard-sub')?.textContent ?? '').not.toContain('Jiǎ')
  })

  it('adds a half sibling by choosing the parents', async () => {
    buttonWith('新增', $('#person .pv-siblings')).click()
    const dlg = topDialog()
    const select = dlg.querySelector<HTMLSelectElement>('select')!
    const options = [...select.options]
    // 祖父's partners include 繼祖母, a co-parent who isn't recorded as his spouse.
    expect(options.map(o => o.value)).toEqual(['gp,gm', 'gp,gm2', 'gp', 'gm'])
    expect(options[0].textContent).toBe('祖父 & 祖母')
    expect(options[1].textContent).toContain('繼祖母')
    expect(options[1].textContent).toContain('同父異母')
    expect(options[2].textContent).toContain('同父異母')
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

  it("lists co-parents as partners, with marriage info that can be set", async () => {
    location.hash = '#/p/gp'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('祖父'))
    const family = [...document.querySelectorAll('#person .pv-families .family')].find(f => f.querySelector('.pcard-name')?.textContent === '繼祖母')!
    expect(family.textContent).toContain('丙')
    buttonWith('新增婚姻資料', family).click()
    const dlg = topDialog()
    const status = dlg.querySelector<HTMLSelectElement>('select[name=status]')!
    const year = dlg.querySelector<HTMLInputElement>('input[name=married-y]')!
    // A date means married; Not married clears and hides the dates.
    year.value = '1965'
    year.dispatchEvent(new Event('input', { bubbles: true }))
    expect(status.value).toBe('married')
    status.value = 'unmarried'
    status.dispatchEvent(new Event('change'))
    expect(year.value).toBe('')
    expect(year.closest('.row')!.hasAttribute('hidden')).toBe(true)
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    const after = [...document.querySelectorAll('#person .pv-families .family')].find(f => f.querySelector('.pcard-name')?.textContent === '繼祖母')!
    expect(after.querySelector('.marriage')!.textContent).toContain('未婚 / Not married')
  })

  it('records a divorce, with or without a divorce date', async () => {
    location.hash = '#/p/gp'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('祖父'))
    const family = () => [...document.querySelectorAll('#person .pv-families .family')].find(f => f.querySelector('.pcard-name')?.textContent === '繼祖母')!
    family().querySelector<HTMLButtonElement>('.marriage button')!.click()
    let dlg = topDialog()
    let status = dlg.querySelector<HTMLSelectElement>('select[name=status]')!
    status.value = 'divorced'
    status.dispatchEvent(new Event('change'))
    const married = dlg.querySelector<HTMLInputElement>('input[name=married-y]')!
    married.value = '1965'
    married.dispatchEvent(new Event('input', { bubbles: true }))
    expect(status.value).toBe('divorced')
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    expect(family().querySelector('.marriage')!.textContent).toContain('結婚 / Married 1965 · 已離婚 / Divorced')

    family().querySelector<HTMLButtonElement>('.marriage button')!.click()
    dlg = topDialog()
    status = dlg.querySelector<HTMLSelectElement>('select[name=status]')!
    status.value = 'married'
    status.dispatchEvent(new Event('change'))
    const divorced = dlg.querySelector<HTMLInputElement>('input[name=divorced-y]')!
    divorced.value = '1975'
    divorced.dispatchEvent(new Event('input', { bubbles: true }))
    expect(status.value).toBe('divorced')
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    expect(family().querySelector('.marriage')!.textContent).toContain('結婚 / Married 1965 · 離婚 / Divorced 1975')
  })

  it('refuses to remove a spouse who shares children', async () => {
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('移除關係', popover()).click()
    const dlg = topDialog()
    const spouses = [...dlg.querySelectorAll('section')].find(s => s.textContent!.includes('伴侶'))!
    const row = [...spouses.querySelectorAll('.pcard')].find(c => c.querySelector('.pcard-name')!.textContent === '祖母')!
    const remove = row.querySelector('button')!
    // Focusable, so the reason can be reached; pressing it says why instead of asking to confirm.
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    expect(remove.title).toContain('Partners who share children')
    expect(row.textContent).toContain('Shares children')
    // The rule is stated up front, as in Reorder; pressing the locked button does nothing.
    expect(dlg.querySelector('.dlg-hint')!.textContent).toContain('Partners who share children')
    remove.click()
    await tick()
    expect(topDialog()).toBe(dlg)
    expect(dlg.querySelector('.dlg-error')!.textContent).toBe('')
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('says to add a parent before siblings, and puts Add on the first sibling section', async () => {
    location.hash = '#/p/gp'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('祖父'))
    // Just a note, with nothing to press.
    expect($('#person .pv-siblings').textContent).toContain('Add a parent before adding siblings')
    expect(document.querySelector('#person .pv-siblings button')).toBeNull()

    location.hash = '#/p/c'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('丙'))
    // 丙's siblings are all half siblings through 祖父, judged the same from both pages.
    expect(document.querySelector('#person .pv-siblings')).toBeNull()
    expect($('#person .pv-half-paternal .section-head').textContent).toContain('新增')
    expect($('#person .pv-half-paternal').textContent).toContain('甲')
    expect($('#person .pv-half-paternal').textContent).toContain('丁')
  })

  it('switches the theme from the settings menu and remembers it', async () => {
    // index.html's status bar color, which follows the theme (the test page has no head of its own).
    const bar = document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color', content: '#f6f3ec' }))
    const settings = $<HTMLButtonElement>('.settings-btn')
    settings.click()
    buttonWith('深色', popover()).click()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('ft-theme')).toBe('dark')
    expect(bar.content).toBe('#1a1815')
    settings.click() // a second click closes the menu
    expect(document.querySelector('.popover')).toBeNull()
    settings.click()
    expect(buttonWith('深色', popover()).getAttribute('aria-pressed')).toBe('true')
    buttonWith('跟隨系統', popover()).click()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('ft-theme')).toBeNull()
    // jsdom has no matchMedia, so the system counts as light.
    expect(bar.content).toBe('#f6f3ec')
    bar.remove()
    // Language names are marked with their language.
    expect(buttonWith('English', popover()).querySelector('[lang=en]')).toBeTruthy()
    expect(buttonWith('中文', popover()).querySelector('[lang=zh-Hant]')).toBeTruthy()
    settings.click()
  })

  it('switches the tree direction from the settings menu and remembers it', async () => {
    const settings = $<HTMLButtonElement>('.settings-btn')
    const chart = $('#chart')
    // Auto by default. jsdom has no layout, so the pane measures 0×0, which Auto lays out horizontally.
    expect(chart.dataset.orientation).toBe('horizontal')
    settings.click()
    expect(buttonWith('自動', popover()).getAttribute('aria-pressed')).toBe('true')
    buttonWith('直式', popover()).click()
    expect(localStorage.getItem('ft-tree-direction')).toBe('vertical')
    expect(chart.dataset.orientation).toBe('vertical')
    expect(document.querySelectorAll('.ft-card[data-id]').length).toBeGreaterThanOrEqual(4)
    buttonWith('自動', popover()).click()
    expect(localStorage.getItem('ft-tree-direction')).toBeNull()
    expect(chart.dataset.orientation).toBe('horizontal')
    settings.click()
  })

  it('hides the person pane, and brings it back from the bar or the selected card', async () => {
    const toggle = $<HTMLButtonElement>('.pane-toggle')
    const main = $('main')
    expect(toggle.getAttribute('aria-label')).toBe('隱藏人物面板 / Hide person panel')
    expect(toggle.getAttribute('aria-controls')).toBe($('.person-pane').id)
    toggle.click()
    expect(main.dataset.pane).toBe('hidden')
    expect(localStorage.getItem('ft-person-pane')).toBe('hidden')
    expect(toggle.getAttribute('aria-label')).toBe('顯示人物面板 / Show person panel')
    // The bar under the tree names the selected person and opens the pane.
    expect($('.peek').textContent).toContain($('#person h1').textContent)
    $<HTMLButtonElement>('.peek').click()
    expect(main.dataset.pane).toBeUndefined()
    expect(localStorage.getItem('ft-person-pane')).toBeNull()
    expect(document.activeElement).toBe($('#person h1'))
    // So does choosing the selected person's card.
    toggle.click()
    const card = $('.ft-card[tabindex="0"]')
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(main.dataset.pane).toBeUndefined()
    expect(document.activeElement).toBe($('#person h1'))
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

  it('labels a parent as adoptive from the more menu, on both pages and in history, and reverts', async () => {
    location.hash = '#/p/b'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('乙'))
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('編輯父母關係', popover()).click()
    const dlg = topDialog()
    const select = dlg.querySelector<HTMLSelectElement>('select[aria-label="關係類型 / Relationship type: 祖父"]')!
    expect([...select.options].map(o => o.value)).toEqual(['', 'adoptive'])
    select.value = 'adoptive'
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect($('#person .pv-parents').textContent).toContain('養父母 / Adoptive parent'))
    const parentCards = [...$('#person .pv-parents').querySelectorAll('.pcard')]
    expect(parentCards.find(c => c.textContent!.includes('祖母'))!.textContent).not.toContain('養父母')
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()

    location.hash = '#/p/gp'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('祖父'))
    const kid = [...$('#person .pv-families').querySelectorAll('.pcard')].find(c => c.textContent!.includes('乙'))!
    expect(kid.textContent).toContain('養子女 / Adopted child')

    buttonWith('修改紀錄').click()
    await tick(300)
    const item = topDialog().querySelector<HTMLElement>('.history-item')!
    expect(item.textContent).toContain('關係類型 / Relationship type (祖父): 親生 / Birth → 收養 / Adoptive')
    item.querySelector('details')!.open = true
    buttonWith('還原', item).click()
    await tick()
    buttonWith('還原', topDialog()).click()
    await vi.waitFor(() => expect($('#person .pv-families').textContent).not.toContain('養子女'))
    topDialog().querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('clears a failed save in Edit parent relationships on the next change', async () => {
    location.hash = '#/p/b'
    await vi.waitFor(() => expect($('#person h1').textContent).toBe('乙'))
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('編輯父母關係', popover()).click()
    const dlg = topDialog()
    const select = dlg.querySelector<HTMLSelectElement>('select')!
    vi.stubGlobal('fetch', (path: string, init?: RequestInit) => path === '/api/commit'
      ? Promise.resolve(new Response(JSON.stringify({ error: 'nope' }), { status: 500 }))
      : w.call(path, init))
    try {
      select.value = 'adoptive'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await vi.waitFor(() => expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Save failed'))
    } finally {
      vi.stubGlobal('fetch', (path: string, init?: RequestInit) => w.call(path, init))
    }
    expect(select.value).toBe('')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(dlg.querySelector('.dlg-error')!.textContent).toBe('')
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('says it could not connect when a save cannot reach the server', async () => {
    buttonWith('編輯', $('#person')).click()
    const dlg = topDialog()
    const online = globalThis.fetch
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    dlg.querySelector<HTMLInputElement>('[name=nameEn]')!.value = 'Offline Edit'
    buttonWith('儲存', dlg).click()
    await vi.waitFor(() => expect(dlg.querySelector('.dlg-error')!.textContent).toContain("Couldn't connect"))
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('儲存失敗')
    expect(dlg.querySelector('.dlg-error')!.textContent).not.toContain('Failed to fetch')
    vi.stubGlobal('fetch', online)
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect($('.offline-banner').hidden).toBe(true))
  })

  it('reorders siblings the dates leave open, saves it in history, and reverts', async () => {
    const kid = (id: string, nameZh: string, order: number, extra = {}) => ({ type: 'set', person: person(id, { nameZh, parents: ['rp'], order, ...extra }) })
    await w.post('/api/commit', { editor: 'import', summary: 'seed', ops: [
      { type: 'set', person: person('rp', { nameZh: '排父', gender: 'M' }) },
      kid('r1', '一', 10), kid('r2', '二', 11), kid('r3', '三', 12),
      // The same father; both are dated, so nothing is left to set by hand.
      { type: 'set', person: person('rq', { nameZh: '定父', gender: 'M' }) },
      kid('d1', '早', 20, { parents: ['rq'], birthDate: '1950' }), kid('d2', '晚', 21, { parents: ['rq'], birthDate: '1960' }),
      // 1961 is before 1962 though added after; 1962-05 and 1962 don't decide, so entry order stands.
      kid('m1', '丙一', 30, { parents: ['rm'], birthDate: '1962-05' }), kid('m2', '丙二', 31, { parents: ['rm'], birthDate: '1962' }),
      kid('m3', '丙三', 32, { parents: ['rm'], birthDate: '1961' }),
      { type: 'set', person: person('rm', { nameZh: '混父', gender: 'M' }) },
    ] })
    document.dispatchEvent(new Event('visibilitychange'))
    await tick(300)
    const order = () => [...$('#person .pv-siblings').querySelectorAll('.pcard-name')].map(e => e.textContent)
    const go = async (id: string, name: string) => {
      location.hash = `#/p/${id}`
      await vi.waitFor(() => expect($('#person h1').textContent).toBe(name))
    }
    await go('r1', '一')
    await vi.waitFor(() => expect(order()).toEqual(['一', '二', '三']))
    buttonWith('排序', $('#person .pv-siblings')).click()
    let dlg = topDialog()
    const btn = (id: string, dir: number) => dlg.querySelector<HTMLButtonElement>(`[data-id="${id}"] button[data-dir="${dir}"]`)!
    // The ends have nowhere to go.
    expect(btn('r1', -1).getAttribute('aria-disabled')).toBe('true')
    expect(btn('r3', 1).getAttribute('aria-disabled')).toBe('true')
    expect(btn('r1', 1).getAttribute('aria-disabled')).toBeNull()
    // 三 up twice, to the front; focus follows the moved button.
    btn('r3', -1).click()
    expect(document.activeElement).toBe(btn('r3', -1))
    btn('r3', -1).click()
    expect(document.activeElement).toBe(btn('r3', -1))
    expect([...dlg.querySelectorAll('.pcard-name')].map(e => e.textContent)).toEqual(['三', '一', '二'])
    buttonWith('儲存', dlg).click()
    await closed(dlg)
    await vi.waitFor(() => expect(order()).toEqual(['三', '一', '二']))
    // The parent's family list shows it too.
    await go('rp', '排父')
    expect([...$('#person .pv-families').querySelectorAll('.pcard-name')].map(e => e.textContent)).toEqual(['三', '一', '二'])

    buttonWith('修改紀錄').click()
    await tick(300)
    const item = topDialog().querySelector<HTMLElement>('.history-item')!
    expect(item.textContent).toContain('調整出生順序 Changed birth order: 三, 一, 二')
    expect(item.textContent).toContain('出生順序已調整 / Birth order changed')
    expect(item.textContent).not.toMatch(/\d{9}/)
    item.querySelector('details')!.open = true
    buttonWith('還原', item).click()
    await tick()
    buttonWith('還原', topDialog()).click()
    await vi.waitFor(() => expect([...$('#person .pv-families').querySelectorAll('.pcard-name')].map(e => e.textContent)).toEqual(['一', '二', '三']))
    topDialog().querySelector<HTMLButtonElement>('.dlg-x')!.click()

    // Dates win: no Reorder button where they order everyone.
    await go('d1', '早')
    expect(buttonWith('排序', $('#person .pv-siblings'))).toBeUndefined()
    // Between 1962-05 and 1962 they don't, but 丙三 (1961) sits ahead of both.
    await go('m1', '丙一')
    await vi.waitFor(() => expect(order()).toEqual(['丙三', '丙一', '丙二']))
    buttonWith('排序', $('#person .pv-siblings')).click()
    dlg = topDialog()
    expect(btn('m3', 1).getAttribute('aria-disabled')).toBe('true')
    expect(btn('m3', 1).title).toBe('下移 / Move down 丙三: 出生日期已決定順序 / Their birth dates already set this order')
    expect(btn('m1', -1).getAttribute('aria-disabled')).toBe('true')
    expect(btn('m3', 1).getAttribute('aria-label')).toContain('出生日期已決定順序')
    // Pressing a locked arrow does nothing, and says nothing.
    btn('m3', 1).click()
    expect(dlg.querySelector('.dlg-error')!.textContent).toBe('')
    expect([...dlg.querySelectorAll('.pcard-name')].map(e => e.textContent)).toEqual(['丙三', '丙一', '丙二'])
    // The rule is stated up front, and rows show full birth dates so it's clear why.
    expect(dlg.querySelector('.dlg-hint')!.textContent).toContain('Siblings with birth dates stay in date order')
    expect([...dlg.querySelectorAll('.pcard-sub')].map(e => e.textContent)).toEqual(['1961', '1962-05', '1962'])
    btn('m1', 1).click()
    expect([...dlg.querySelectorAll('.pcard-name')].map(e => e.textContent)).toEqual(['丙三', '丙二', '丙一'])
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('shows a banner and blocks editing while the data is the offline copy, then recovers', async () => {
    const online = globalThis.fetch
    const cachedAt = Date.UTC(2026, 0, 2, 3, 4)
    // The service worker answers from its cache with this header when the network is down.
    vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
      const res = await w.call(path, init)
      const headers = new Headers(res.headers)
      headers.set('X-Offline-Cached-At', String(cachedAt))
      return new Response(res.body, { status: res.status, headers })
    })
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect($('.offline-banner').hidden).toBe(false))
    expect($('.offline-banner').textContent).toContain('離線：顯示')
    expect($('.offline-banner').textContent).toContain('2026')
    expect(document.querySelector('.status:not([hidden])')).toBeNull()

    // Every write flow refuses with a toast, without opening a form.
    $<HTMLButtonElement>('#person .pv-actions .primary').click()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect($('.toast').textContent).toContain('離線時無法修改')
    $('.toast').textContent = ''
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('刪除', popover()).click()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect($('.toast').textContent).toContain('離線時無法修改')
    // So does the shared write path, for any flow that forgets to check.
    const { commit } = await import('../src/backend')
    await expect(commit([], { editor: 'x', summary: 'x' })).rejects.toThrow('離線時無法修改')

    // A failed poll while offline keeps the banner and doesn't show the red status.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    window.dispatchEvent(new Event('online'))
    await tick()
    expect($('.offline-banner').hidden).toBe(false)
    expect(document.querySelector('.status:not([hidden])')).toBeNull()

    // Back online: the banner clears.
    vi.stubGlobal('fetch', online)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect($('.offline-banner').hidden).toBe(true))
    $<HTMLButtonElement>('#person .pv-actions .primary').click()
    expect(topDialog()).toBeTruthy()
    topDialog().querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('reports a sign-in check that fails, rather than calling it signed out', async () => {
    const online = globalThis.fetch
    const { getSession } = await import('../src/backend')
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(getSession()).rejects.toThrow()
    vi.stubGlobal('fetch', online)
    await expect(getSession()).resolves.toBe(true)
  })

  it('says so when signing out fails, and still drops the offline data', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', { delete: async (name: string) => { deleted.push(name); return true } })
    const online = globalThis.fetch
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    $<HTMLButtonElement>('.settings-btn').click()
    buttonWith('登出', popover()).click()
    await vi.waitFor(() => expect($('.toast').textContent).toContain('無法登出'))
    expect(deleted).toEqual(['zupu-data-v1'])
    vi.stubGlobal('fetch', online)
    // Back online, the offline banner the failed request raised clears.
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect($('.offline-banner').hidden).toBe(true))
  })

  it('deletes the offline data cache on sign-out', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', { delete: async (name: string) => { deleted.push(name); return true } })
    // Imported late, like main: the modules need the jsdom globals.
    const { signOut } = await import('../src/backend')
    await signOut()
    expect(deleted).toEqual(['zupu-data-v1'])
  })
})
