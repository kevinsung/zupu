import './styles.css'
import { h, wide } from './dom'
import { L, getLang, setLang, t, type Key, type Lang } from './i18n'
import { authApi, backend, type AuthApi } from './backend'
import { FamilyStore, type Backend } from './store'
import { TreeChart } from './chart'
import type { AppCtx } from './actions'
import { renderPerson } from './person'
import { openHistory } from './history'
import { openSearch, rememberRecent, searchBox } from './search'
import { avatar, personSubtitle } from './cards'
import { focusPersonHeading, menuList, mountToast, openDialog, openMenu, personForm, segmented } from './dialog'
import { displayName, seniorAncestor } from './model'
import { getTheme, setTheme, type Theme } from './theme'
import { type IconName, icon } from './icons'

const EDITOR_KEY = 'ft-editor'
const root = document.getElementById('app')!

/** The app name in the top bar. Not a heading: each person's name is the page's h1. */
function brand() {
  const [zh, en] = t.title.split(' / ')
  return h('div', { class: 'brand' }, h('span', {}, zh), en ? h('small', { lang: 'en' }, en) : null)
}

function showLogin(authApi: AuthApi) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', required: true })
  const error = h('p', { class: 'dlg-error', role: 'alert' })
  const button = h('button', { type: 'submit', class: 'primary' }, L('signIn'))
  const form = h('form', { class: 'login' },
    h('h1', { class: 'brand' }, h('span', {}, '族譜'), h('small', { lang: 'en' }, 'Family Tree')),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, L('password')), input),
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
  // Phones open on the tree; tapping the selected person (or the bar under the tree) opens their page.
  let view: View = 'tree'
  let chartStale = true

  const chartEl = h('div', { id: 'chart', class: 'f3' })
  const personEl = h('div', { id: 'person' })
  const status = h('div', { class: 'status', role: 'status' }, t.loading)
  // Names the person each time the selection changes, for screen readers on any layout.
  const announcer = h('div', { class: 'sr-only', 'aria-live': 'polite' })
  const emptyEl = h('div', { class: 'empty', hidden: true },
    h('button', { type: 'button', class: 'primary', onclick: () => addFirst() }, icon('plus'), h('span', {}, L('addFirst'))))

  const editorName = () => localStorage.getItem(EDITOR_KEY) ?? ''
  const settingsLabel = h('span', { class: 'settings-name' })
  const settingsBtn = h('button', { type: 'button', class: 'ghost settings-btn', 'aria-haspopup': 'dialog', title: t.settings },
    icon('settings'), settingsLabel, icon('chevronDown', 'caret'))
  const refreshEditor = () => {
    settingsLabel.textContent = editorName() || t.settings
    settingsBtn.setAttribute('aria-label', `${t.settings}: ${t.editorLabel} ${editorName() || '—'}`)
  }
  refreshEditor()

  function askEditor(): Promise<string | null> {
    return new Promise(resolve => {
      const input = h('input', { type: 'text', value: editorName(), autocomplete: 'off', enterkeyhint: 'done', 'aria-label': t.editorLabel })
      const save = () => {
        const name = input.value.trim()
        if (!name) return false
        localStorage.setItem(EDITOR_KEY, name)
        refreshEditor()
        resolve(name)
      }
      const close = openDialog(L('editorLabel'), h('div', { class: 'form' }, input), [
        { label: L('save'), primary: true, run: save },
      ], { onDismiss: () => resolve(null), subtitle: t.editorPrompt })
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && save() !== false) close() })
      input.focus()
    })
  }

  const ctx: AppCtx = {
    store,
    select: id => { location.hash = `#/p/${id}` },
    editorName: async () => editorName() || askEditor(),
    showHistory: personId => openHistory(ctx, backend, personId),
  }

  const chart = new TreeChart(chartEl, id => {
    // In the tree, tapping a card moves the focus there; the person page follows along.
    if (id === selected) { if (!wide.matches) setView('person') } else ctx.select(id)
  }, !wide.matches)

  // Phone-only bar under the tree that names the selected person and opens their page.
  const peekAvatar = h('span', { class: 'peek-avatar' })
  const peekName = h('strong', {})
  const peekSub = h('span', { class: 'muted' })
  const peek = h('button', { type: 'button', class: 'peek', onclick: () => setView('person') },
    peekAvatar, h('span', { class: 'peek-text' }, peekName, peekSub), h('span', { class: 'peek-go' }, h('span', {}, L('viewPerson')), icon('chevronRight')))

  const tool = (label: string, name: IconName, onclick: () => void) =>
    h('button', { type: 'button', title: label, 'aria-label': label, onclick }, icon(name))
  const treePane = h('section', { class: 'pane tree-pane', 'aria-label': t.title },
    chartEl,
    h('div', { class: 'chart-tools', role: 'toolbar', 'aria-label': t.title },
      tool(t.zoomIn, 'plus', () => chart.zoom(1.3)),
      tool(t.zoomOut, 'minus', () => chart.zoom(1 / 1.3)),
      tool(t.center, 'center', () => chart.center()),
      tool(t.fit, 'fit', () => chart.fit())),
    peek)
  const personPane = h('section', { class: 'pane person-pane' }, personEl)
  const main = h('main', {}, treePane, personPane, emptyEl, status, announcer)

  const tab = (v: View | 'search' | 'menu', name: IconName, label: Key, onclick: (e: Event) => void) =>
    h('button', { type: 'button', class: 'tab', 'data-tab': v, onclick }, icon(name, 'tab-icon'), h('span', { class: 'tab-label' }, L(label)))
  const tabbar = h('nav', { class: 'tabbar' },
    tab('tree', 'tree', 'tabTree', () => setView('tree')),
    tab('person', 'person', 'tabPerson', () => setView('person')),
    tab('search', 'search', 'tabSearch', () => search()),
    tab('menu', 'menu', 'tabMenu', () => openSettings()))

  const treeVisible = () => wide.matches || view === 'tree'

  function setView(v: View) {
    view = v
    main.dataset.view = v
    tabbar.querySelectorAll<HTMLElement>('.tab').forEach(b => {
      if (b.dataset.tab === v) b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    })
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

  const box = searchBox(() => store.people, id => ctx.select(id), () => selected)

  function search() {
    if (wide.matches) box.focus()
    else openSearch(() => store.people, ctx.select, selected)
  }

  function signOut() {
    authApi.signOut().then(() => location.reload())
  }

  /** Editor name, appearance, language and sign-out: a menu under the top-bar button, or a sheet from the phone's Menu tab. */
  function openSettings(anchor?: HTMLElement) {
    let close = () => {}
    const row = (label: Key, control: Node) =>
      h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, L(label)), control)
    const body = h('div', { class: 'settings' },
      anchor ? null : menuList([{ icon: 'history', label: L('history'), run: () => openHistory(ctx, backend) }], () => close()),
      row('editorLabel', h('button', { type: 'button', class: 'setting-value', onclick: () => { close(); askEditor() } },
        h('span', {}, editorName() || '—'), h('span', { class: 'chip' }, L('change')))),
      row('appearance', segmented<Theme>(t.appearance,
        [['auto', L('themeAuto')], ['light', L('themeLight')], ['dark', L('themeDark')]], getTheme(), setTheme)),
      row('language', segmented<Lang>(t.language,
        [['both', '中英'], ['zh', '中文'], ['en', 'English']], getLang(), lang => { setLang(lang); location.reload() })),
      menuList([{ icon: 'signOut', label: L('signOut'), run: signOut }], () => close()))
    close = openMenu(anchor ? t.settings : t.menu, body, anchor)
  }
  settingsBtn.addEventListener('click', () => openSettings(settingsBtn))

  function idFromHash() {
    return /^#\/p\/(.+)$/.exec(location.hash)?.[1] ?? ''
  }

  function renderPersonPane() {
    // On wide screens the tree is always in view, so the person menu doesn't offer to show it.
    renderPerson(personEl, ctx, selected, { showInTree: wide.matches ? undefined : () => setView('tree') })
  }

  function render(recenter: boolean) {
    const people = store.people
    const prev = selected
    emptyEl.hidden = people.size > 0
    if (people.size === 0) {
      personEl.replaceChildren()
      chart.reset()
      return
    }
    if (!people.has(selected)) {
      const candidates = [idFromHash(), seniorAncestor(people)?.id, people.keys().next().value]
      selected = candidates.find(id => id && people.has(id))!
      recenter = true
    }
    rememberRecent(selected)
    if (idFromHash() !== selected) history.replaceState(null, '', `#/p/${selected}`)
    renderChart(recenter)
    const p = people.get(selected)!
    peekAvatar.replaceChildren(avatar(p))
    peekName.textContent = displayName(p)
    peekSub.textContent = personSubtitle(p)
    // Re-rendering the page destroys whatever had focus in it (a relative's card, Edit). Put focus
    // on the new name instead of letting it fall to <body>. The tree moves focus to its own cards.
    const active = document.activeElement
    const lostFocus = !!active && personEl.contains(active)
    renderPersonPane()
    document.title = `${displayName(p)} — ${t.title}`
    if (prev && prev !== selected) announcer.textContent = displayName(p)
    if (lostFocus || (prev && prev !== selected && active === document.body)) focusPersonHeading()
  }

  function addFirst() {
    const form = personForm()
    openDialog(L('addFirst'), form.el, [
      {
        label: L('save'), primary: true, run: async () => {
          const fields = form.read()
          const editor = await ctx.editorName()
          if (!editor) return false
          ctx.select(await store.createPerson(editor, fields))
        },
      },
    ])
    form.focus()
  }

  root.replaceChildren(
    h('header', { class: 'topbar' },
      brand(),
      box.el,
      h('nav', { class: 'topnav' },
        h('button', { type: 'button', class: 'ghost', onclick: () => openHistory(ctx, backend) },
          icon('history'), h('span', {}, L('history'))),
        settingsBtn),
    ),
    main,
    tabbar,
  )
  mountToast()
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
  const onWide = () => {
    setView(view)
    if (store.people.has(selected)) renderPersonPane()
  }
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
