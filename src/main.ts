import './styles.css'
import { h } from './dom'
import { t, tabs } from './i18n'
import { authApi, backend, type AuthApi } from './backend'
import { FamilyStore, type Backend } from './store'
import { TreeChart } from './chart'
import type { AppCtx } from './actions'
import { renderPerson } from './person'
import { openHistory } from './history'
import { openSearch, rememberRecent } from './search'
import { personSubtitle } from './cards'
import { actionSheet, openDialog, personForm } from './dialog'
import { displayName, rootAncestors } from './model'
import { getTheme, setTheme, type Theme } from './theme'

const LAST_KEY = 'ft-last-person'
const EDITOR_KEY = 'ft-editor'
const themeLabels: Record<Theme, string> = { auto: t.themeAuto, light: t.themeLight, dark: t.themeDark }
const root = document.getElementById('app')!

function showLogin(authApi: AuthApi) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', required: true })
  const error = h('p', { class: 'dlg-error', role: 'alert' })
  const button = h('button', { type: 'submit', class: 'primary' }, t.signIn)
  const form = h('form', { class: 'login' },
    h('h1', { class: 'brand' }, h('span', {}, '族譜'), h('small', {}, 'Family Tree')),
    h('label', { class: 'field' }, h('span', {}, t.password), input),
    button, error)
  form.addEventListener('submit', async e => {
    e.preventDefault()
    error.textContent = ''
    button.disabled = true
    try {
      await authApi.signIn(input.value)
    } catch (err) {
      const code = (err as { code?: string }).code
      error.textContent = code === 'too-many-requests' ? t.tooManyAttempts
        : code === 'wrong-password' ? t.wrongPassword
        : (err as Error).message
      input.select()
    } finally {
      button.disabled = false
    }
  })
  root.replaceChildren(form)
  input.focus()
}

type View = 'person' | 'tree'

function startApp(backend: Backend, authApi: AuthApi): () => void {
  const store = new FamilyStore(backend)
  let selected = ''
  // Phones show one pane at a time; wide screens show the tree and the person side by side.
  const wide = window.matchMedia?.('(min-width: 900px)') ?? { matches: true, addEventListener() {}, removeEventListener() {} }
  // Phones open on the tree; tapping the selected person (or the bar under the tree) opens their page.
  let view: View = 'tree'
  let chartStale = true

  const chartEl = h('div', { id: 'chart', class: 'f3' })
  const personEl = h('div', { id: 'person' })
  const editorBtn = h('button', { type: 'button', class: 'ghost' })
  const status = h('div', { class: 'status', role: 'status' }, t.loading)
  const emptyEl = h('div', { class: 'empty', hidden: true },
    h('button', { type: 'button', class: 'primary', onclick: () => addFirst() }, `＋ ${t.addFirst}`))

  const editorName = () => localStorage.getItem(EDITOR_KEY) ?? ''
  const refreshEditor = () => { editorBtn.textContent = `${t.editorLabel}: ${editorName() || '—'}` }
  refreshEditor()

  function askEditor(): Promise<string | null> {
    return new Promise(resolve => {
      const input = h('input', { type: 'text', value: editorName(), autocomplete: 'name', enterkeyhint: 'done' })
      openDialog(t.editorPrompt, h('div', { class: 'form' }, input), [
        { label: t.cancel, run: () => resolve(null) },
        {
          label: t.save, primary: true, run: () => {
            const name = input.value.trim()
            if (!name) return false
            localStorage.setItem(EDITOR_KEY, name)
            refreshEditor()
            resolve(name)
          },
        },
      ], () => resolve(null))
      input.focus()
    })
  }

  const ctx: AppCtx = {
    store,
    select: id => { location.hash = `#/p/${id}` },
    editorName: async () => editorName() || askEditor(),
  }

  const chart = new TreeChart(chartEl, id => {
    // In the tree, tapping a card moves the focus there; the person page follows along.
    if (id === selected) { if (!wide.matches) setView('person') } else ctx.select(id)
  }, !wide.matches)

  // Phone-only bar under the tree that names the selected person and opens their page.
  const peekName = h('strong', {})
  const peekSub = h('span', { class: 'muted' })
  const peek = h('button', { type: 'button', class: 'peek', onclick: () => setView('person') },
    h('span', { class: 'peek-text' }, peekName, peekSub), h('span', { class: 'peek-go' }, `${t.viewPerson} ›`))

  const treePane = h('section', { class: 'pane tree-pane', 'aria-label': t.title },
    chartEl,
    h('div', { class: 'chart-tools' },
      h('button', { type: 'button', class: 'icon', title: t.zoomIn, 'aria-label': t.zoomIn, onclick: () => chart.zoom(1.3) }, '+'),
      h('button', { type: 'button', class: 'icon', title: t.zoomOut, 'aria-label': t.zoomOut, onclick: () => chart.zoom(1 / 1.3) }, '−'),
      h('button', { type: 'button', class: 'icon', title: t.center, 'aria-label': t.center, onclick: () => chart.center() }, '◎')),
    peek)
  const personPane = h('section', { class: 'pane person-pane' }, personEl)
  const main = h('main', {}, treePane, personPane, emptyEl, status)

  const tab = (v: View | 'search' | 'menu', icon: string, onclick: () => void) => {
    const [zh, en] = tabs[v]
    return h('button', { type: 'button', class: 'tab', 'data-tab': v, onclick },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'tab-zh' }, zh), h('span', { class: 'tab-en' }, en))
  }
  const tabbar = h('nav', { class: 'tabbar' },
    tab('tree', '🌳', () => setView('tree')),
    tab('person', '👤', () => setView('person')),
    tab('search', '🔍', () => search()),
    tab('menu', '☰', () => openMenu()))

  const treeVisible = () => wide.matches || view === 'tree'

  function setView(v: View) {
    view = v
    main.dataset.view = v
    tabbar.querySelectorAll<HTMLElement>('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === v))
    if (v === 'person') personPane.scrollTop = 0
    if (treeVisible() && chartStale) renderChart(true)
    else if (v === 'tree') chart.center(0)
  }

  function renderChart(recenter: boolean) {
    // family-chart measures its container, so it can't lay out while hidden: defer until shown.
    if (!treeVisible()) { chartStale = true; return }
    chartStale = false
    chart.render(store.people, selected, recenter)
  }

  function search() {
    openSearch(() => store.people, ctx.select, selected)
  }

  function signOut() {
    authApi.signOut().then(() => location.reload())
  }

  function openMenu() {
    actionSheet(t.menu, [
      { icon: '🕘', label: t.history, run: () => openHistory(ctx, backend) },
      { icon: '✎', label: `${t.editorLabel}: ${editorName() || '—'}`, run: () => askEditor() },
      { icon: '◐', label: `${t.appearance}: ${themeLabels[getTheme()]}`, run: openTheme },
      { icon: '⎋', label: t.signOut, run: signOut },
    ])
  }

  function openTheme() {
    const current = getTheme()
    actionSheet(t.appearance, (['auto', 'light', 'dark'] as const).map(theme => ({
      icon: theme === current ? '✓' : '', label: themeLabels[theme], run: () => setTheme(theme),
    })))
  }

  function idFromHash() {
    return /^#\/p\/(.+)$/.exec(location.hash)?.[1] ?? ''
  }

  function render(recenter: boolean) {
    const people = store.people
    emptyEl.hidden = people.size > 0
    if (people.size === 0) {
      personEl.replaceChildren()
      chart.reset()
      return
    }
    if (!people.has(selected)) {
      const candidates = [idFromHash(), localStorage.getItem(LAST_KEY) ?? '', rootAncestors(people)[0]?.id, people.keys().next().value]
      selected = candidates.find(id => id && people.has(id))!
      recenter = true
    }
    localStorage.setItem(LAST_KEY, selected)
    rememberRecent(selected)
    if (idFromHash() !== selected) history.replaceState(null, '', `#/p/${selected}`)
    renderChart(recenter)
    const p = people.get(selected)!
    peekName.textContent = displayName(p)
    peekSub.textContent = personSubtitle(p)
    renderPerson(personEl, ctx, selected, { showInTree: () => setView('tree') })
    document.title = `${displayName(p)} — ${t.title}`
  }

  function addFirst() {
    const form = personForm()
    openDialog(t.addFirst, form.el, [
      { label: t.cancel },
      {
        label: t.save, primary: true, run: async () => {
          const fields = form.read()
          const editor = await ctx.editorName()
          if (!editor) return false
          ctx.select(await store.createPerson(editor, fields))
        },
      },
    ])
  }

  editorBtn.addEventListener('click', () => askEditor())

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('h1', { class: 'brand' }, h('span', {}, '族譜'), h('small', {}, 'Family Tree')),
      h('button', { type: 'button', class: 'search-trigger', onclick: search },
        h('span', { 'aria-hidden': 'true' }, '🔍'), h('span', {}, t.search), h('kbd', {}, '/')),
      h('nav', { class: 'topnav' },
        h('button', { type: 'button', class: 'ghost', onclick: () => openHistory(ctx, backend) }, t.history),
        editorBtn,
        h('button', { type: 'button', class: 'ghost', onclick: openTheme }, t.appearance),
        h('button', { type: 'button', class: 'ghost', onclick: signOut }, t.signOut)),
    ),
    main,
    tabbar,
  )
  setView(view)

  const onHash = () => {
    const id = idFromHash()
    if (id && id !== selected && store.people.has(id)) {
      selected = id
      render(true)
      personPane.scrollTop = 0
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || document.querySelector('dialog[open]')) return
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    e.preventDefault()
    search()
  }
  // Crossing the breakpoint (rotating a tablet, resizing a window) may reveal the tree.
  const onWide = () => setView(view)
  window.addEventListener('hashchange', onHash)
  window.addEventListener('keydown', onKey)
  wide.addEventListener('change', onWide)

  const onError = (e: Error) => {
    status.textContent = `${t.loadFailed}: ${e.message}`
    status.hidden = false
  }
  const unsubPeople = backend.subscribePeople(list => {
    status.hidden = true
    store.setPeople(list)
    render(false)
  }, onError)

  return () => {
    unsubPeople()
    window.removeEventListener('hashchange', onHash)
    window.removeEventListener('keydown', onKey)
    wide.removeEventListener('change', onWide)
  }
}

let stop: (() => void) | null = null
authApi.onChange(signedIn => {
  stop?.()
  stop = null
  if (signedIn) stop = startApp(backend, authApi)
  else showLogin(authApi)
})
