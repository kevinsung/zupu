import './styles.css'
import { h } from './dom'
import { t } from './i18n'
import { authApi, backend, type AuthApi } from './backend'
import { FamilyStore, type Backend } from './store'
import { TreeChart } from './chart'
import { renderPanel, type AppCtx } from './panel'
import { openHistory } from './history'
import { openDialog, personForm, personPicker } from './dialog'
import { coupleLabel, rootAncestors } from './model'

const LAST_KEY = 'ft-last-person'
const EDITOR_KEY = 'ft-editor'
const root = document.getElementById('app')!

function showLogin(authApi: AuthApi) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', required: true })
  const error = h('p', { class: 'dlg-error', role: 'alert' })
  const button = h('button', { type: 'submit', class: 'primary' }, t.signIn)
  const form = h('form', { class: 'login' },
    h('h1', {}, t.title),
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

function startApp(backend: Backend, authApi: AuthApi): () => void {
  const store = new FamilyStore(backend)
  let selected = ''

  const chartEl = h('div', { id: 'chart', class: 'f3' })
  const panelEl = h('aside', { id: 'panel' })
  const ancestors = h('select', { 'aria-label': t.ancestors })
  const editorBtn = h('button', { type: 'button', class: 'ghost' })
  const status = h('div', { class: 'status' }, t.loading)

  const editorName = () => localStorage.getItem(EDITOR_KEY) ?? ''
  const refreshEditor = () => { editorBtn.textContent = `${t.editorLabel}: ${editorName() || '—'}` }
  refreshEditor()

  function askEditor(): Promise<string | null> {
    return new Promise(resolve => {
      const input = h('input', { type: 'text', value: editorName(), autocomplete: 'name' })
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

  const chart = new TreeChart(chartEl, ctx.select)

  function idFromHash() {
    return /^#\/p\/(.+)$/.exec(location.hash)?.[1] ?? ''
  }

  function render(recenter: boolean) {
    const people = store.people
    if (people.size === 0) {
      panelEl.replaceChildren()
      chart.reset()
      chartEl.append(h('div', { class: 'empty' },
        h('button', { type: 'button', class: 'primary', onclick: addFirst }, `＋ ${t.addFirst}`)))
      return
    }
    if (!people.has(selected)) {
      const candidates = [idFromHash(), localStorage.getItem(LAST_KEY) ?? '', rootAncestors(people)[0]?.id, people.keys().next().value]
      selected = candidates.find(id => id && people.has(id))!
      recenter = true
    }
    localStorage.setItem(LAST_KEY, selected)
    if (idFromHash() !== selected) history.replaceState(null, '', `#/p/${selected}`)
    chart.render(people, selected, recenter)
    renderPanel(panelEl, ctx, selected)

    ancestors.replaceChildren(h('option', { value: '' }, t.ancestors),
      ...rootAncestors(people).map(p => h('option', { value: p.id }, coupleLabel(people, p))))
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

  ancestors.addEventListener('change', () => {
    if (ancestors.value) ctx.select(ancestors.value)
    ancestors.value = ''
  })
  editorBtn.addEventListener('click', () => askEditor())

  const search = personPicker(() => store.people, p => ctx.select(p.id))
  search.el.classList.add('header-search')

  root.replaceChildren(
    h('header', {},
      h('h1', {}, t.title),
      search.el,
      ancestors,
      h('button', { type: 'button', onclick: () => openHistory(ctx, backend) }, t.history),
      editorBtn,
      h('button', { type: 'button', class: 'ghost', onclick: async () => { await authApi.signOut(); location.reload() } }, t.signOut),
    ),
    h('main', {}, chartEl, panelEl, status),
  )

  const onHash = () => {
    const id = idFromHash()
    if (id && id !== selected && store.people.has(id)) {
      selected = id
      render(true)
      panelEl.scrollTop = 0
    }
  }
  window.addEventListener('hashchange', onHash)

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
  }
}

let stop: (() => void) | null = null
authApi.onChange(signedIn => {
  stop?.()
  stop = null
  if (signedIn) stop = startApp(backend, authApi)
  else showLogin(authApi)
})
