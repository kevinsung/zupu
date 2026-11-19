// Talks to the Worker API (worker/index.ts). Keeps everyone roughly in sync by polling a cheap
// version number while the tab is visible.
import { pair } from './i18n'
import { ApiError, NetworkError, UserError } from './errors'
import type { Person } from './model'
import type { ChangeRecord, NewChange, Op } from './ops'

const POLL_MS = 30_000

/** The service worker's cache of API reads (public/sw.js uses the same name). Holds family data, so it goes on sign-out. */
export const DATA_CACHE = 'zupu-data-v1'
const OFFLINE_HEADER = 'X-Offline-Cached-At'

/**
 * Drops the offline copy of the family data. Safe where there is no Cache API or service worker.
 * The service worker is told too, so a cache write it still has in flight can't put the data back.
 */
export async function clearDataCache() {
  try {
    globalThis.navigator?.serviceWorker?.controller?.postMessage('clear-data')
  } catch {}
  try {
    await globalThis.caches?.delete(DATA_CACHE)
  } catch {}
}

// When offline, the time of the data on screen: the service worker's cache time, or when it was last fetched.
export let offlineSince: number | null = null
let lastFetchedAt = Date.now()
const offlineListeners = new Set<(since: number | null) => void>()

/** Calls `cb` whenever the app goes offline or comes back. */
export function onOfflineChange(cb: (since: number | null) => void) {
  offlineListeners.add(cb)
}

function setOffline(since: number | null) {
  if (since === offlineSince) return
  offlineSince = since
  offlineListeners.forEach(cb => cb(since))
}

/** The browser says the network is gone (or back); the next request confirms it. */
export function setNetworkState(online: boolean) {
  if (online) refreshNow()
  else setOffline(lastFetchedAt)
}

export { ApiError }

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/${path}`, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    setOffline(offlineSince ?? lastFetchedAt)
    throw new NetworkError((e as Error).message)
  }
  const cachedAt = Number(res.headers.get(OFFLINE_HEADER))
  if (cachedAt) {
    lastFetchedAt = cachedAt
    setOffline(cachedAt)
  } else if (res.ok) {
    lastFetchedAt = Date.now()
    setOffline(null)
  }
  if (res.status === 401 && path !== 'login') {
    // Session expired or password changed: drop the offline data, then back to the login screen.
    await clearDataCache()
    location.reload()
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    // The Worker's message is English developer detail; errorText words the failure for people.
    throw new ApiError(res.status, data.error ?? res.statusText)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

let version = -1
let refreshNow = () => {}
let peopleListener: (people: Person[]) => void = () => {}
const changeListeners = new Set<(changes: ChangeRecord[]) => void>()

async function loadPeople() {
  const data = await api<{ people: Person[]; version: number }>('people')
  version = data.version
  peopleListener(data.people)
}

async function loadChanges() {
  if (changeListeners.size === 0) return
  const { changes } = await api<{ changes: ChangeRecord[] }>('changes')
  changeListeners.forEach(cb => cb(changes))
}

/** Loads everyone now, then reloads whenever the data version moves. Call once, at startup. */
export function watchPeople(cb: (people: Person[]) => void, onError: (e: Error) => void) {
  peopleListener = cb
  loadPeople().catch(onError)
  const refreshIfChanged = async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const { version: latest } = await api<{ version: number }>('version')
      if (latest !== version) await Promise.all([loadPeople(), loadChanges()])
    } catch (e) {
      onError(e as Error)
    }
  }
  // Coming back online: reload at once, even if the version happens to match what the cache held.
  refreshNow = () => {
    Promise.all([loadPeople(), loadChanges()]).catch(onError)
  }
  setInterval(refreshIfChanged, POLL_MS)
  document.addEventListener('visibilitychange', refreshIfChanged)
}

/** The change log now and after every change, until the returned function is called. */
export function watchChanges(cb: (changes: ChangeRecord[]) => void, onError: (e: Error) => void): () => void {
  changeListeners.add(cb)
  api<{ changes: ChangeRecord[] }>('changes').then(d => cb(d.changes), onError)
  return () => changeListeners.delete(cb)
}

export async function commit(ops: Op[], change: NewChange) {
  // The UI refuses first, with a toast (canEdit in actions.ts); this catches any flow that forgets to.
  if (offlineSince !== null) throw new UserError(pair('offlineNoEdit'))
  await api('commit', { ops, ...change })
  // Resolve only once the UI has the new data, so callers can navigate to new people.
  await Promise.all([loadPeople(), loadChanges()])
}

/** The server's (or the offline copy's) answer; rejects when there is none, e.g. offline with nothing cached or a 5xx. */
export async function getSession(): Promise<boolean> {
  return (await api<{ signedIn: boolean }>('session')).signedIn
}

/** Fetches every read the service worker keeps for offline use, so one that just took control has a copy. */
export function refetchForOffline() {
  api('session').catch(() => {})
  refreshNow()
}

/** Rejects with an ApiError: status 401 for a wrong password, 429 after too many attempts. */
export async function signIn(password: string) {
  await api('login', { password })
}

export async function signOut() {
  try {
    await api('logout', {})
  } finally {
    await clearDataCache()
  }
}
