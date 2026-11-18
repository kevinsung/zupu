import './styles.css'
import { h, wide } from './dom'
import { L, getLang, setLang, t, type Key, type Lang } from './i18n'
import { ApiError, commit, getSession, signIn, signOut, watchPeople } from './backend'
import { FamilyStore } from './store'
import { TREE_HINT_ID, TreeChart, getTreeDirection, setTreeDirection, type TreeDirection } from './chart'
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
const PANE_KEY = 'ft-person-pane'
const root = document.getElementById('app')!

/** The app name: the login screen's h1, and plain text in the top bar, where each person's name is the h1. */
function brand(tag: 'h1' | 'div') {
  return h(tag, { class: 'brand' }, L('title'))
}

function showLogin() {
  const input = h('input', { type: 'password', autocomplete: 'current-password', required: true })
  const error = h('p', { class: 'dlg-error', role: 'alert' })
  const button = h('button', { type: 'submit', class: 'primary' }, L('signIn'))
  const form = h('form', { class: 'login' },
    brand('h1'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, L('password')), input),
    button, error)
  form.addEventListener('submit', async e => {
    e.preventDefault()
    error.textContent = ''
    button.disabled = true
    try {
      await signIn(input.value)
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      error.textContent = status === 429 ? t.tooManyAttempts
        : status === 401 ? t.wrongPassword
        : (err as Error).message
      input.select()
      button.disabled = false
      return
    }
    startApp()
  })
  root.replaceChildren(form)
  input.focus()
}

type View = 'person' | 'tree'

function startApp() {
  const store = new FamilyStore(commit)
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

  const savedEditor = () => localStorage.getItem(EDITOR_KEY) ?? ''
  const settingsLabel = h('span', { class: 'settings-name' })
  const settingsBtn = h('button', { type: 'button', class: 'ghost settings-btn', 'aria-haspopup': 'dialog', title: t.settings },
    icon('settings'), settingsLabel, icon('chevronDown', 'caret'))
  const refreshEditor = () => {
    settingsLabel.textContent = savedEditor() || t.settings
    settingsBtn.setAttribute('aria-label', `${t.settings}: ${t.editorLabel} ${savedEditor() || '—'}`)
  }
  refreshEditor()

  function askEditor(): Promise<string | null> {
    return new Promise(resolve => {
      const input = h('input', { type: 'text', value: savedEditor(), autocomplete: 'off', enterkeyhint: 'done', 'aria-label': t.editorLabel })
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
    editorName: async () => savedEditor() || askEditor(),
    showHistory: personId => openHistory(ctx, personId),
  }

  const chart = new TreeChart(chartEl, id => {
    // In the tree, tapping a card moves the focus there; the person page follows along.
    if (id === selected) openPerson()
    else ctx.select(id)
  }, { direction: getTreeDirection(), compact: !wide.matches })

  /** Opens the selected person's page: the phone's Person tab, or the hidden side pane. */
  function openPerson() {
    if (!wide.matches) setView('person')
    else if (paneHidden) setPaneHidden(false, true)
  }

  // On wide screens the person pane can be hidden to give the tree the whole width.
  let paneHidden = localStorage.getItem(PANE_KEY) === 'hidden'
  const paneToggle = h('button', { type: 'button', class: 'pane-toggle', onclick: () => setPaneHidden(!paneHidden) })
  function setPaneHidden(hidden: boolean, focusPage = false) {
    paneHidden = hidden
    if (hidden) localStorage.setItem(PANE_KEY, 'hidden')
    else localStorage.removeItem(PANE_KEY)
    if (hidden) main.dataset.pane = 'hidden'
    else delete main.dataset.pane
    const label = hidden ? t.showPane : t.hidePane
    paneToggle.title = label
    paneToggle.setAttribute('aria-label', label)
    paneToggle.replaceChildren(icon(hidden ? 'paneShow' : 'paneHide'))
    if (focusPage) { personPane.scrollTop = 0; focusPersonHeading() }
  }

  // Bar under the tree that names the selected person and opens their page: on phones, and on
  // wide screens while the person pane is hidden.
  const peekAvatar = h('span', { class: 'peek-avatar' })
  const peekName = h('strong', {})
  const peekSub = h('span', { class: 'muted' })
  const peek = h('button', { type: 'button', class: 'peek', onclick: () => openPerson() },
    peekAvatar, h('span', { class: 'peek-text' }, peekName, peekSub), h('span', { class: 'peek-go' }, h('span', {}, L('viewPerson')), icon('chevronRight')))

  const tool = (label: string, name: IconName, onclick: () => void) =>
    h('button', { type: 'button', title: label, 'aria-label': label, onclick }, icon(name))
  const treePane = h('section', { class: 'pane tree-pane', 'aria-label': t.tabTree },
    chartEl,
    h('p', { id: TREE_HINT_ID, class: 'sr-only' }, t.treeKeysHint),
    h('div', { class: 'chart-tools', role: 'group', 'aria-label': t.treeControls },
      tool(t.zoomIn, 'plus', () => chart.zoom(1.3)),
      tool(t.zoomOut, 'minus', () => chart.zoom(1 / 1.3)),
      tool(t.center, 'center', () => chart.center()),
      tool(t.fit, 'fit', () => chart.fit()),
      paneToggle),
    peek)
  const personPane = h('section', { class: 'pane person-pane', 'aria-label': t.tabPerson }, personEl)
  const main = h('main', {}, treePane, personPane, emptyEl, status, announcer)
  personPane.id = 'person-pane'
  paneToggle.setAttribute('aria-controls', personPane.id)
  setPaneHidden(paneHidden)

  const tab = (v: View | 'search' | 'menu', name: IconName, label: Key, onclick: (e: Event) => void) =>
    h('button', { type: 'button', class: 'tab', 'data-tab': v, onclick }, icon(name, 'tab-icon'), h('span', { class: 'tab-label' }, L(label)))
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': t.navTabs },
    tab('tree', 'tree', 'tabTree', () => setView('tree')),
    tab('person', 'person', 'tabPerson', () => setView('person')),
    tab('search', 'search', 'tabSearch', () => search()),
    tab('menu', 'menu', 'tabMenu', () => openSettings()))

  const treeVisible = () => wide.matches || view === 'tree'

  function setView(v: View) {
    // "Show in tree" (phones) is chosen from the person page, which is about to be hidden.
    const fromPerson = v === 'tree' && personPane.contains(document.activeElement)
    view = v
    main.dataset.view = v
    tabbar.querySelectorAll<HTMLElement>('.tab').forEach(b => {
      if (b.dataset.tab === v) b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    })
    if (v === 'person') {
      personPane.scrollTop = 0
      // Opening the page from the tree (the selected card, the bar under it) hides what had focus.
      if (treePane.contains(document.activeElement)) focusPersonHeading()
    }
    if (treeVisible() && chartStale) renderChart(true)
    else if (v === 'tree') chart.center(0)
    // Either way the selected person's card is centered, and drawn by now (family-chart renders synchronously).
    if (fromPerson && !wide.matches) chart.focusMain()
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


  /** Editor name, appearance, tree direction, language and sign-out: a menu under the top-bar button, or a sheet from the phone's Menu tab. */
  function openSettings(anchor?: HTMLElement) {
    let close = () => {}
    const row = (label: Key, control: Node) =>
      h('div', { class: 'setting' }, h('span', { class: 'setting-label' }, L(label)), control)
    const body = h('div', { class: 'settings' },
      anchor ? null : menuList([{ icon: 'history', label: L('history'), run: () => openHistory(ctx) }], () => close()),
      row('editorLabel', h('button', { type: 'button', class: 'setting-value', onclick: () => { close(); askEditor() } },
        h('span', {}, savedEditor() || '—'), h('span', { class: 'chip' }, L('change')))),
      row('appearance', segmented<Theme>(t.appearance,
        [['auto', L('themeAuto')], ['light', L('themeLight')], ['dark', L('themeDark')]], getTheme(), setTheme)),
      row('treeDirection', segmented<TreeDirection>(t.treeDirection,
        [['auto', L('treeAuto')], ['horizontal', L('treeHorizontal')], ['vertical', L('treeVertical')]], getTreeDirection(), direction => {
          setTreeDirection(direction)
          chart.setLayout({ direction })
          chartStale = true
          renderChart(true)
        })),
      row('language', segmented<Lang>(t.language,
        [['both', h('span', { lang: 'zh-Hant' }, '中英')], ['zh', h('span', { lang: 'zh-Hant' }, '中文')], ['en', h('span', { lang: 'en' }, 'English')]],
        getLang(), lang => { setLang(lang); location.reload() })),
      menuList([{ icon: 'signOut', label: L('signOut'), run: () => signOut().then(() => location.reload()) }], () => close()))
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
      brand('div'),
      box.el,
      h('nav', { class: 'topnav', 'aria-label': t.navTop },
        h('button', { type: 'button', class: 'ghost', onclick: () => openHistory(ctx) },
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
  // The tree's cards change size too, so redraw it, now or once it's shown.
  const onWide = () => {
    chart.setLayout({ compact: !wide.matches })
    chartStale = true
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
  watchPeople(list => {
    status.hidden = true
    store.setPeople(list)
    render(false)
  }, onError)
}

getSession().then(signedIn => (signedIn ? startApp() : showLogin()))
