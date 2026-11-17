// Smoke test of the whole UI talking to the real Worker + local D1: login, chart, panel, editing, history.
// Runs in the node environment and installs jsdom globals by hand *after* starting the Worker,
// because wrangler/esbuild refuse to load inside vitest's jsdom environment.
import { JSDOM } from 'jsdom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { populateGlobal } from 'vitest/runtime'
import { emptyFields } from '../src/model'
import { startWorker } from './worker-env'

const person = (id: string, extra: Record<string, unknown> = {}) =>
  ({ ...emptyFields(), id, parents: [], spouses: [], order: 0, ...extra })
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
    $('.search-trigger').click()
    const dlg = $('dialog[open]')
    expect([...dlg.querySelectorAll('.pcard-name')].map(e => e.textContent)).toContain('祖父 & 祖母')
    const input = dlg.querySelector<HTMLInputElement>('input[type=search]')!
    input.value = 'alice'
    input.dispatchEvent(new Event('input'))
    buttonWith('甲', dlg).click()
    await tick(100)
    expect(dlg.isConnected).toBe(false)
    expect($('#person h2').textContent).toBe('甲')
    expect($('#person .pv-parents').textContent).toContain('祖父')
    expect($('#person .pv-siblings').textContent).toContain('乙')
    $('.search-trigger').click()
    const again = $('dialog[open]')
    expect(again.textContent).toContain('祖父')
    again.querySelector<HTMLButtonElement>('.dlg-x')!.click()
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
    buttonWith('編輯 / Edit', $('#person')).click()
    const dlg = $('dialog[open]')
    dlg.querySelector<HTMLInputElement>('input[name=birthDate]')!.value = '60'
    buttonWith('儲存', dlg).click()
    await tick()
    expect(dlg.querySelector('.dlg-error')!.textContent).toContain('YYYY')
    dlg.querySelector<HTMLInputElement>('input[name=birthDate]')!.value = '1960-03'
    buttonWith('儲存', dlg).click()
    await tick(300)
    expect($('#person .facts').textContent).toContain('1960-03')
  })

  it('logs changes in history and can revert', async () => {
    buttonWith('修改紀錄').click()
    await tick(300)
    const dlg = $('dialog[open]')
    const items = dlg.querySelectorAll('.history > li')
    expect(items.length).toBe(3) // seed + spouse + edit
    expect(items[0].textContent).toContain('Tester')
    expect(items[0].textContent).toContain('1960 → 1960-03')
    buttonWith('還原', items[0]).click()
    await tick()
    buttonWith('還原', [...document.querySelectorAll('dialog[open]')].at(-1)!).click()
    await tick(300)
    expect($('#person .facts').textContent).not.toContain('1960-03')
  })

  it('removes a relationship from the more menu', async () => {
    $<HTMLButtonElement>('#person .pv-actions .more').click()
    buttonWith('移除關係', topDialog()).click()
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

  it('edits contact info and shows email and phone as links', async () => {
    buttonWith('編輯 / Edit', $('#person')).click()
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

  it('switches the theme from the menu and remembers it', async () => {
    const pickTheme = (label: string) => {
      $('[data-tab=menu]').click()
      buttonWith('外觀', topDialog()).click()
      buttonWith(label, topDialog()).click()
    }
    pickTheme('深色')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('ft-theme')).toBe('dark')
    $('[data-tab=menu]').click()
    expect(topDialog().textContent).toContain('Appearance: 深色 / Dark')
    topDialog().querySelector<HTMLButtonElement>('.dlg-x')!.click()
    pickTheme('跟隨系統')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('ft-theme')).toBeNull()
  })
})
