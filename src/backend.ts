// Talks to the Worker API (worker/index.ts). Keeps everyone roughly in sync by polling a cheap
// version number while the tab is visible.
import { newId } from './ids'
import type { Person } from './model'
import type { Backend, ChangeRecord } from './store'

const POLL_MS = 30_000

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401 && path !== 'login') {
    // Session expired or password changed: back to the login screen.
    location.reload()
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new ApiError(res.status, data.error ?? res.statusText)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

let version = -1
const peopleListeners = new Set<(people: Person[]) => void>()
const changeListeners = new Set<(changes: ChangeRecord[]) => void>()
const errorListeners = new Set<(e: Error) => void>()
let pollTimer: ReturnType<typeof setInterval> | undefined

async function loadPeople() {
  const data = await api<{ people: Person[]; version: number }>('people')
  version = data.version
  peopleListeners.forEach(cb => cb(data.people))
}

async function loadChanges() {
  if (changeListeners.size === 0) return
  const { changes } = await api<{ changes: ChangeRecord[] }>('changes')
  changeListeners.forEach(cb => cb(changes))
}

async function refreshIfChanged() {
  try {
    const { version: latest } = await api<{ version: number }>('version')
    if (latest !== version) await Promise.all([loadPeople(), loadChanges()])
  } catch (e) {
    errorListeners.forEach(cb => cb(e as Error))
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') refreshIfChanged()
}

export const backend: Backend = {
  newId,

  subscribePeople(cb, onError) {
    peopleListeners.add(cb)
    errorListeners.add(onError)
    loadPeople().catch(onError)
    if (!pollTimer) {
      pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshIfChanged() }, POLL_MS)
      document.addEventListener('visibilitychange', onVisible)
    }
    return () => {
      peopleListeners.delete(cb)
      errorListeners.delete(onError)
      if (peopleListeners.size === 0) {
        clearInterval(pollTimer)
        pollTimer = undefined
        document.removeEventListener('visibilitychange', onVisible)
      }
    }
  },

  subscribeChanges(cb, onError) {
    changeListeners.add(cb)
    api<{ changes: ChangeRecord[] }>('changes').then(d => cb(d.changes), onError)
    return () => changeListeners.delete(cb)
  },

  async commit(ops, change) {
    await api('commit', { ops, ...change })
    // Resolve only once the UI has the new data, so callers can navigate to new people.
    await Promise.all([loadPeople(), loadChanges()])
  },
}

export async function getSession(): Promise<boolean> {
  return api<{ signedIn: boolean }>('session').then(d => d.signedIn, () => false)
}

/** Rejects with an ApiError: status 401 for a wrong password, 429 after too many attempts. */
export async function signIn(password: string) {
  await api('login', { password })
}

export async function signOut() {
  await api('logout', {})
}
