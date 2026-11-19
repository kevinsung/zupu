import './styles.css'
import { h, standalone, wide } from './dom'
import { L, getLang, locale, pair, setLang, t, tTime, type Key, type Lang } from './i18n'
import { errorText } from './errors'
import { ApiError, clearDataCache, commit, getSession, offlineSince, onOfflineChange, refetchForOffline, setNetworkState, signIn, signOut, watchPeople } from './backend'
import { FamilyStore } from './store'
import { TREE_HINT_ID, TreeChart, getTreeDirection, setTreeDirection, type TreeDirection } from './chart'
import { type AppCtx, canEdit } from './actions'
import { renderPerson } from './person'
import { openHistory } from './history'
import { homeList, rememberRecent, searchBox } from './search'
import { statsPage } from './stats'
import { avatar, personSubtitle } from './cards'
import { focusPersonHeading, menuList, mountToast, openDialog, openMenu, personForm, segmented, toast } from './dialog'
import { displayName } from './model'
import { getTheme, setTheme, type Theme } from './theme'
import { type IconName, icon } from './icons'

const EDITOR_KEY = 'ft-editor'
const PANE_KEY = 'ft-person-pane'
const SOURCE_URL = 'https://github.com/kevinsung/zupu'
const root = document.getElementById('app')!

/** The app name: the login screen's h1, and in the top bar a link to the list of everyone (each person's name is the h1 there). */
function brand(tag: 'h1' | 'a') {
  return h(tag, { class: 'brand', href: tag === 'a' ? '#/' : undefined }, L('title'))
}

/** `signedOut`: the server said so, rather than the check failing (offline with nothing cached, a 5xx). */
function showLogin(signedOut: boolean) {
  // Nobody is signed in, so no family data may stay on the device. A failed check proves nothing,
  // and the offline copy may be all a signed-in user has.
  if (signedOut) clearDataCache()
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
        : errorText(err)
      input.select()
      button.disabled = false
      return
    }
    // Ask again: the service worker's offline copy of the session is still the signed-out answer
    // this screen got, and an offline launch would trust it.
    await getSession().catch(() => {})
    startApp()
  })
  root.replaceChildren(form)
  input.focus()
}

// 'home' is the list of everyone, the phone's Search tab.
// 'stats' is the family stats page, `#/stats`; like home it takes the whole width.
type View = 'home' | 'person' | 'tree' | 'stats'

function idFromHash() {
  return /^#\/p\/(.+)$/.exec(location.hash)?.[1] ?? ''
}

const statsHash = () => location.hash === '#/stats'

function startApp() {
  const store = new FamilyStore(commit)
  // Kept after going back to the list, so the phone's Tree and Person tabs still show this person.
  let selected = ''
  // A link to someone opens on their page (on phones; wide screens show the tree beside it).
  // Otherwise the app opens on the list, with no one selected.
  let view: View = idFromHash() ? 'person' : statsHash() ? 'stats' : 'home'
  let loaded = false
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
    home: () => goHome(),
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
  const chartTools = h('div', { class: 'chart-tools', role: 'group', 'aria-label': t.treeControls },
    tool(t.zoomIn, 'plus', () => chart.zoom(1.3)),
    tool(t.zoomOut, 'minus', () => chart.zoom(1 / 1.3)),
    tool(t.center, 'center', () => chart.center()),
    tool(t.fit, 'fit', () => chart.fit()),
    paneToggle)
  /** What the Tree and Person tabs show before anyone is picked: a way back to the list. */
  const nobody = () => h('div', { class: 'nobody' },
    h('p', { class: 'muted' }, L('noneSelected')),
    h('button', { type: 'button', class: 'primary', onclick: () => goHome() }, icon('search'), h('span', {}, L('choosePerson'))))
  const treeNobody = nobody()
  const treePane = h('section', { class: 'pane tree-pane', 'aria-label': t.tabTree },
    chartEl,
    h('p', { id: TREE_HINT_ID, class: 'sr-only' }, t.treeKeysHint),
    chartTools,
    peek,
    treeNobody)
  const personPane = h('section', { class: 'pane person-pane', 'aria-label': t.tabPerson }, personEl)
  const home = homeList(() => store.people, id => ctx.select(id))
  const homePane = h('section', { class: 'pane home-pane', 'aria-label': t.tabSearch }, home.el)
  const stats = statsPage(() => store.people, id => ctx.select(id))
  const statsPane = h('section', { class: 'pane stats-pane', 'aria-label': t.stats }, stats.el)
  const main = h('main', {}, homePane, statsPane, treePane, personPane, emptyEl, status, announcer)
  personPane.id = 'person-pane'
  paneToggle.setAttribute('aria-controls', personPane.id)
  setPaneHidden(paneHidden)

  const tab = (v: View | 'menu', name: IconName, label: Key, onclick: (e: Event) => void) =>
    h('button', { type: 'button', class: 'tab', 'data-tab': v, onclick }, icon(name, 'tab-icon'), h('span', { class: 'tab-label' }, L(label)))
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': t.navTabs },
    tab('home', 'search', 'tabSearch', () => search()),
    tab('tree', 'tree', 'tabTree', () => openTab('tree')),
    tab('person', 'person', 'tabPerson', () => openTab('person')),
    tab('stats', 'chart', 'stats', () => openStats()),
    tab('menu', 'menu', 'tabMenu', () => openSettings()))
  const topBrand = brand('a')
  const statsBtn = h('button', { type: 'button', class: 'ghost', onclick: () => openStats() },
    icon('chart'), h('span', {}, L('stats')))

  // Wide screens show the tree beside the person, but not on the list, which takes the whole width.
  const treeVisible = () => view !== 'home' && view !== 'stats' && (wide.matches || view === 'tree')

  function setView(v: View) {
    // "Show in tree" (phones) is chosen from the person page, which is about to be hidden.
    const fromPerson = v === 'tree' && personPane.contains(document.activeElement)
    // Going back to the list hides what had focus (Back from a person's page, say).
    const entering = v === 'home' && view !== 'home'
    const hidingFocus = entering && (statsPane.contains(document.activeElement) || treePane.contains(document.activeElement) || personPane.contains(document.activeElement))
    // Same for the stats page, which can also be left from the list.
    const enteringStats = v === 'stats' && view !== 'stats'
    const statsHidingFocus = enteringStats && (homePane.contains(document.activeElement) || treePane.contains(document.activeElement) || personPane.contains(document.activeElement))
    view = v
    main.dataset.view = v
    tabbar.querySelectorAll<HTMLElement>('.tab').forEach(b => {
      if (b.dataset.tab === v) b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    })
    placeSearch()
    if (v === 'home') topBrand.setAttribute('aria-current', 'page')
    else topBrand.removeAttribute('aria-current')
    if (v === 'stats') statsBtn.setAttribute('aria-current', 'page')
    else statsBtn.removeAttribute('aria-current')
    setTitle()
    if (v === 'stats') {
      if (enteringStats && loaded) stats.refresh()
      if (statsHidingFocus) stats.el.querySelector<HTMLElement>('h1')!.focus({ preventScroll: true })
      return
    }
    if (v === 'home') {
      // Recently viewed has changed since the list was last built.
      if (entering) home.refresh()
      if (hidingFocus) homePane.querySelector<HTMLElement>('h1')!.focus({ preventScroll: true })
      return
    }
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
    if (!treeVisible() || !selected) { chartStale = true; return }
    chartStale = false
    chart.render(store.people, selected, recenter)
  }

  function setTitle() {
    const p = view !== 'home' && view !== 'stats' ? store.people.get(selected) : undefined
    document.title = view === 'stats' ? `${t.stats} — ${t.title}` : p ? `${displayName(p)} — ${t.title}` : t.title
  }

  /** The list of everyone. Leaves the person's address, so Back returns to them. */
  function goHome() {
    if (idFromHash() || statsHash()) location.hash = '#/'
    setView('home')
  }

  /** The stats page. The address may already be `#/stats` (the phone's Tree tab, with no one picked, keeps it), and then no hashchange comes. */
  function openStats() {
    if (statsHash()) setView('stats')
    else location.hash = '#/stats'
  }

  /** The phone's Tree and Person tabs. The person shown gets their address back, as a step Back can undo. */
  function openTab(v: 'tree' | 'person') {
    setView(v)
    if (selected && idFromHash() !== selected) ctx.select(selected)
  }

  const box = searchBox(() => store.people, id => ctx.select(id), () => selected)
  // On wide screens the list's filter takes the top-bar search's place, so there's one box,
  // filtering the list in place rather than dropping results down under it.
  const homeSlot = h('div', { class: 'search-box', hidden: true }, h('kbd', { 'aria-hidden': 'true' }, '/'))

  function placeSearch() {
    const inTop = wide.matches && view === 'home'
    const input = home.input
    if (inTop === homeSlot.contains(input)) return
    const focused = document.activeElement === input
    if (inTop) homeSlot.prepend(input)
    else home.head.prepend(input)
    input.classList.toggle('search-trigger', inTop)
    input.classList.toggle('home-filter', !inTop)
    homeSlot.hidden = !inTop
    home.head.hidden = inTop
    box.el.hidden = inTop
    if (focused) input.focus({ preventScroll: true })
  }

  /** `/` and the phone's Search tab: the list's own filter, or the top-bar search while someone is shown on a wide screen. */
  function search() {
    if (wide.matches && view !== 'home') { box.focus(); return }
    goHome()
    home.focus()
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
      standalone.matches || (navigator as { standalone?: boolean }).standalone ? null
        : h('p', { class: 'setting setting-hint' }, L('installHint')),
      menuList([
        { icon: 'source', label: L('sourceCode'), run: () => window.open(SOURCE_URL, '_blank', 'noopener') },
        { icon: 'signOut', label: L('signOut'), run: () => signOut().then(() => location.reload(), () => toast(t.signOutFailed, { error: true })) },
      ], () => close()))
    close = openMenu(anchor ? t.settings : t.menu, body, anchor)
  }
  settingsBtn.addEventListener('click', () => openSettings(settingsBtn))

  function renderPersonPane() {
    // On wide screens the tree is always in view, so the person menu doesn't offer to show it.
    renderPerson(personEl, ctx, selected, { showInTree: wide.matches ? undefined : () => setView('tree') })
  }

  function render(recenter: boolean) {
    const people = store.people
    const prev = selected
    loaded = true
    emptyEl.hidden = people.size > 0
    home.refresh()
    stats.refresh()
    // `#/p/<id>` selects that person; someone unknown (deleted, or a bad link) means the list.
    // On `#/stats` this is '': no one new is selected, but whoever was stays for the phone's tabs.
    const id = idFromHash()
    if (id && !people.has(id)) {
      history.replaceState(null, '', '#/')
      setView('home')
    } else if (id && id !== selected) {
      selected = id
      recenter = true
    }
    if (!people.has(selected)) selected = ''
    if (id === selected && selected) rememberRecent(selected)
    // Picking someone from the list opens the tree around them (beside their page on wide screens).
    const fromHome = (view === 'home' || view === 'stats') && !!id && id === selected
    if (!selected) {
      chart.reset()
      chartStale = true
      personEl.replaceChildren(nobody())
    } else {
      renderChart(recenter)
    }
    for (const el of [chartTools, peek]) el.hidden = !selected
    treeNobody.hidden = !!selected
    if (!selected) { setTitle(); return }
    const p = people.get(selected)!
    peekAvatar.replaceChildren(avatar(p))
    peekName.textContent = displayName(p)
    peekSub.textContent = personSubtitle(p)
    // Re-rendering the page destroys whatever had focus in it (a relative's card, Edit). Put focus
    // on the new name instead of letting it fall to <body>. The tree moves focus to its own cards.
    const active = document.activeElement
    const lostFocus = !!active && personEl.contains(active)
    renderPersonPane()
    if (fromHome) {
      setView('tree')
      personPane.scrollTop = 0
    }
    setTitle()
    if (prev && prev !== selected) announcer.textContent = displayName(p)
    // The list that had focus is hidden now: on phones focus goes to their card in the tree, which
    // is all that's shown, and on wide screens to their name.
    if (fromHome && !wide.matches) chart.focusMain()
    else if (fromHome || lostFocus || (prev && prev !== selected && active === document.body)) focusPersonHeading()
  }

  function addFirst() {
    if (!canEdit()) return
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

  // Shown while the data on screen is the offline copy; sits between the top bar and the panes, covering neither.
  const offlineBanner = h('div', { class: 'offline-banner', role: 'status', hidden: true })
  const timeFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const showOffline = (since: number | null) => {
    offlineBanner.hidden = since === null
    if (since !== null) offlineBanner.textContent = tTime('offlineBanner', timeFmt.format(since))
  }
  onOfflineChange(showOffline)
  showOffline(offlineSince)
  window.addEventListener('online', () => setNetworkState(true))
  window.addEventListener('offline', () => setNetworkState(false))

  root.replaceChildren(
    h('header', { class: 'topbar' },
      topBrand,
      box.el,
      homeSlot,
      h('nav', { class: 'topnav', 'aria-label': t.navTop },
        statsBtn,
        h('button', { type: 'button', class: 'ghost', onclick: () => openHistory(ctx) },
          icon('history'), h('span', {}, L('history'))),
        settingsBtn),
    ),
    offlineBanner,
    main,
    tabbar,
  )
  mountToast()
  setView(view)

  const onHash = () => {
    if (!loaded) return
    const id = idFromHash()
    if (statsHash()) setView('stats')
    else if (!id) setView('home')
    else if (id !== selected || view === 'home' || view === 'stats') {
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
    // Offline, a failed poll just keeps the banner; only a start with nothing to show is an error.
    if (offlineSince !== null && loaded) return
    status.textContent = errorText(e, pair('loadFailed'))
    status.hidden = false
  }
  watchPeople(list => {
    status.hidden = true
    store.setPeople(list)
    render(false)
  }, onError)
}

// Offline reads come from the service worker's cache (public/sw.js); production only, so dev is unaffected.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // On the first visit this page's reads go out before the service worker takes over, so it has
  // no copy of them; fetch them again once it does.
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', refetchForOffline, { once: true })
  }
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

getSession().then(signedIn => (signedIn ? startApp() : showLogin(true)), () => showLogin(false))
