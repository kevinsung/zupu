// Service worker: lets the installed app open and show family data offline (read-only).
// Plain JS, served at /sw.js so it covers the whole site. Hand-written; no build step touches it.
// DATA_CACHE must match DATA_CACHE in src/backend.ts: the page deletes it on sign-out and on 401.
const SHELL_CACHE = 'zupu-shell-v1'
const DATA_CACHE = 'zupu-data-v1'
/** API reads kept for offline use. /api/version and every write go straight to the network. */
const DATA_PATHS = ['/api/session', '/api/people', '/api/changes']
/** Files whose names don't change between deploys, unlike the hashed ones under /assets/. */
const STATIC_FILES = ['/favicon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/manifest.webmanifest']
const ASSET_REF = /\/assets\/[\w.-]+\.\w+/g
/** Everything cached is same-origin and the same for every request, so a Vary header (e.g. Origin) mustn't cause a miss. */
const MATCH = { ignoreVary: true }

const isHtml = res => (res.headers.get('Content-Type') ?? '').includes('text/html')

/** A hashed build file from the cache (it never changes), else fetched and stored; its text when it can refer to others. */
async function asset(cache, url) {
  let res = await cache.match(url, MATCH)
  if (!res) {
    res = await fetch(url, { cache: 'reload' })
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    await cache.put(url, res.clone())
  }
  return /\.(js|css)$/.test(url) ? res.text() : ''
}

/**
 * Stores `page` (the response for /) once everything it loads from /assets/ (directly or through its
 * scripts and styles) is cached, then drops the assets of earlier deploys, which nothing refers to now.
 */
async function cacheShell(cache, page) {
  const html = await page.clone().text()
  const reached = new Set()
  let level = [...new Set(html.match(ASSET_REF) ?? [])]
  while (level.length) {
    level.forEach(url => reached.add(url))
    const texts = await Promise.all(level.map(url => asset(cache, url)))
    level = [...new Set(texts.flatMap(text => text.match(ASSET_REF) ?? []))].filter(url => !reached.has(url))
  }
  await cache.put('/', page)
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname
    if (path.startsWith('/assets/') && !reached.has(path)) await cache.delete(req)
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    const page = await fetch('/', { cache: 'reload' })
    if (!page.ok || !isHtml(page)) throw new Error(`/: ${page.status}`)
    await Promise.all([
      cacheShell(cache, page),
      ...STATIC_FILES.map(async url => {
        // Optional files: a missing icon must not block the install.
        try {
          const res = await fetch(url, { cache: 'reload' })
          if (res.ok) await cache.put(url, res)
        } catch {}
      }),
    ])
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      const stale = (name.startsWith('zupu-shell-') && name !== SHELL_CACHE) || (name.startsWith('zupu-data-') && name !== DATA_CACHE)
      if (stale) await caches.delete(name)
    }
    await self.clients.claim()
  })())
})

/** The page, network first, so a deploy shows up as soon as the device is online; the cached page when it isn't. */
async function navigate(event) {
  try {
    const res = await fetch(event.request)
    if (res.ok && res.type === 'basic' && isHtml(res)) {
      // A new deploy: cache its assets, then the page, then drop the old assets. Unchanged: nothing to do.
      const copy = res.clone()
      event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE)
        const old = await cache.match('/', MATCH)
        if (old && (await old.text()) === (await copy.clone().text())) return
        await cacheShell(cache, copy)
      })().catch(() => {}))
    }
    return res
  } catch (e) {
    const cached = await caches.match('/', { ...MATCH, cacheName: SHELL_CACHE })
    if (cached) return cached
    throw e
  }
}

/** Hashed build assets: cache first, as they never change. Other static files: the cached copy, refreshed for next time. */
async function staticFile(event) {
  const { request } = event
  const cached = await caches.match(request, { ...MATCH, cacheName: SHELL_CACHE })
  if (cached && new URL(request.url).pathname.startsWith('/assets/')) return cached
  const fetched = fetch(request).then(async res => {
    if (res.status === 200 && res.type === 'basic') await (await caches.open(SHELL_CACHE)).put(request, res.clone())
    return res
  })
  if (!cached) return fetched
  event.waitUntil(fetched.catch(() => {}))
  return cached
}

/** Copy of `res` stamped with when it was cached, which is how the page knows it is offline. */
async function stamped(res) {
  const headers = new Headers(res.headers)
  headers.set('X-Offline-Cached-At', String(Date.now()))
  return new Response(await res.blob(), { status: 200, statusText: res.statusText, headers })
}

// Writes to and the clearing of DATA_CACHE run one at a time, in order. A write started before the
// page asked for a clear (sign-out, expired session) is dropped, so it can't put the data back.
let clears = 0
let dataQueue = Promise.resolve()
const queueData = op => (dataQueue = dataQueue.then(op).catch(() => {}))

/** Network first; on failure the last 200 response, or the network error when there is none. */
async function data(event) {
  const { request } = event
  const asOf = clears
  try {
    const res = await fetch(request)
    if (res.status === 200) {
      const stored = stamped(res.clone())
      event.waitUntil(queueData(async () => {
        if (asOf === clears) await (await caches.open(DATA_CACHE)).put(request.url, await stored)
      }))
    }
    return res
  } catch (e) {
    const cached = await (await caches.open(DATA_CACHE)).match(request.url, MATCH)
    return cached ?? Response.error()
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // The app is the one page at /; anything else opened in a tab (an API URL, an icon) isn't the app.
  if (request.mode === 'navigate') {
    if (url.pathname === '/') event.respondWith(navigate(event))
  } else if (DATA_PATHS.includes(url.pathname)) event.respondWith(data(event))
  else if (url.pathname.startsWith('/assets/') || STATIC_FILES.includes(url.pathname)) event.respondWith(staticFile(event))
})

// Sent by clearDataCache in src/backend.ts, which also deletes the cache itself.
self.addEventListener('message', event => {
  if (event.data !== 'clear-data') return
  clears++
  event.waitUntil(queueData(() => caches.delete(DATA_CACHE)))
})
