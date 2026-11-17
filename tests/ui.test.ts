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
    expect($('#person h2').textContent).toBe('祖父')
    expect(location.hash).toMatch(/^#\/p\//)
    expect(document.querySelectorAll('.ft-card').length).toBeGreaterThanOrEqual(4)
  })

  it('navigates via search, which lists family lines and recent people', async () => {
    const input = $<HTMLInputElement>('.search-trigger')
    const pop = $('.search-pop')
    expect(pop.hidden).toBe(true)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(pop.hidden).toBe(false)
    expect([...pop.querySelectorAll('.pcard-name')].map(e => e.textContent)).toContain('祖父 & 祖母')
    input.value = 'alice'
    input.dispatchEvent(new Event('input'))
    buttonWith('甲', pop).click()
    await tick(100)
    expect(pop.hidden).toBe(true)
    expect($('#person h2').textContent).toBe('甲')
    expect($('#person .pv-parents').textContent).toContain('祖父')
    // This person appears among their siblings, in birth order, and isn't a link.
    expect($('#person .pv-siblings').textContent).toContain('乙')
    expect($('#person .pv-siblings .pcard.self').textContent).toContain('甲')
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
    await tick(300)
    expect(document.querySelectorAll('dialog[open]').length).toBe(0)
    expect($('#person').textContent).toContain('丈夫')
    expect(document.querySelector('header')!.textContent).toContain('Tester')
  })

  it('rejects bad dates in the edit form', async () => {
    buttonWith('編輯', $('#person')).click()
    const dlg = $('dialog[open]')
    expect(dlg.querySelector('.dlg-sub')!.textContent).toBe('甲')
    dlg.querySelector<HTMLInputElement>('input[name=birthDate]')!.value = '60'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('YYYY')
    dlg.querySelector<HTMLInputElement>('input[name=birthDate]')!.value = '1960-03'
    buttonWith('儲存', dlg).click()
    await tick(300)
    expect($('#person .pv-dates').textContent).toContain('1960-03')
  })

  it('logs changes in history and can revert', async () => {
    buttonWith('修改紀錄').click()
    await tick(300)
    const dlg = $('dialog[open]')
    const items = dlg.querySelectorAll('.history-item')
    expect(items.length).toBe(3) // seed + spouse + edit
    expect(items[0].textContent).toContain('Tester')
    expect(items[0].textContent).toContain('1960 → 1960-03')
    buttonWith('還原', items[0]).click()
    await tick()
    buttonWith('還原', [...document.querySelectorAll('dialog[open]')].at(-1)!).click()
    await tick(300)
    expect($('#person .pv-dates').textContent).not.toContain('1960-03')
  })

  it("shows one person's history from the more menu", async () => {
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('此人的修改紀錄', popover()).click()
    await tick(300)
    const dlg = topDialog()
    expect(dlg.querySelector('.dlg-sub')!.textContent).toBe('甲')
    const items = [...dlg.querySelectorAll('.history-item')].map(li => li.textContent)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(text => !text!.includes('祖父 → '))).toBe(true)
    dlg.querySelector<HTMLButtonElement>('.dlg-x')!.click()
  })

  it('removes a relationship from the more menu', async () => {
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('移除關係', popover()).click()
    expect(document.querySelector('.popover')).toBeNull()
    const dlg = topDialog()
    expect(dlg.textContent).toContain('丈夫')
    const row = [...dlg.querySelectorAll('.pcard')].find(c => c.textContent!.includes('丈夫'))!
    buttonWith('移除', row).click()
    await tick()
    buttonWith('移除', topDialog()).click()
    await tick(300)
    expect(dlg.isConnected).toBe(false)
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
    await tick(300)
    expect(dlg.isConnected).toBe(false)
    expect($('#person .pv-families').textContent).toContain('丈夫')
  })

  it('adds marriage dates under a spouse and shows them in history', async () => {
    const families = () => $('#person .pv-families')
    buttonWith('新增結婚日期', families()).click()
    const dlg = topDialog()
    dlg.querySelector<HTMLInputElement>('input[name=married]')!.value = '85'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('YYYY')
    dlg.querySelector<HTMLInputElement>('input[name=married]')!.value = '1985-10'
    buttonWith('儲存', dlg).click()
    await tick(300)
    expect(dlg.isConnected).toBe(false)
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
    set('email', 'alice@')
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Invalid email')
    set('email', 'alice@example.com')
    set('phone', '201-555-0123')
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('Invalid phone')
    set('phone', '+1 (201) 555-0123')
    set('line', 'alice_line')
    buttonWith('儲存', dlg).click()
    await tick(300)
    expect(dlg.isConnected).toBe(false)
    const contact = $('#person .contact')
    expect(contact.querySelector('a[href="mailto:alice@example.com"]')).toBeTruthy()
    expect(contact.querySelector('a[href="tel:+12015550123"]')!.textContent).toBe('+1 201 555 0123')
    expect(contact.textContent).toContain('alice_line')
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
  })
})
