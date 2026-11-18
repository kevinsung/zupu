import { normalizePerson, type People } from '../src/model'
import { simulate, type ChangeRecord } from '../src/ops'
import { clearCookie, isRateLimited, isSignedIn, passwordMatches, recordFailure, sessionCookie } from './auth'
import { BadRequest, checkResult, parseCommit } from './validate'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /** Set with `npx wrangler secret put FAMILY_PASSWORD` (or .dev.vars locally). */
  FAMILY_PASSWORD: string
}

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } })
const error = (status: number, message: string) => json({ error: message }, { status })

// D1 allows at most 100 bound parameters per query.
const chunks = <T,>(list: T[], size = 90) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

const VERSION_SQL = 'SELECT COALESCE(MAX(seq), 0) AS v FROM changes'

async function version(env: Env): Promise<number> {
  const row = await env.DB.prepare(VERSION_SQL).first<{ v: number }>()
  return row?.v ?? 0
}

async function listPeople(env: Env) {
  // One batch (a single transaction), so the version always matches the people returned.
  const [people, ver] = await env.DB.batch([env.DB.prepare('SELECT id, data FROM people'), env.DB.prepare(VERSION_SQL)])
  return {
    people: (people.results as { id: string; data: string }[]).map(r => normalizePerson(r.id, JSON.parse(r.data))),
    version: (ver.results[0] as { v: number }).v,
  }
}

async function listChanges(env: Env): Promise<ChangeRecord[]> {
  const { results } = await env.DB.prepare('SELECT seq, editor, at, summary, diffs FROM changes ORDER BY seq DESC LIMIT 300')
    .all<{ seq: number; editor: string; at: number; summary: string; diffs: string }>()
  return results.map(r => ({ id: String(r.seq), editor: r.editor, at: r.at, summary: r.summary, diffs: JSON.parse(r.diffs) }))
}

/**
 * Apply ops atomically and log them. Diffs are computed here from the stored data, not trusted
 * from the browser. (Reads and the write batch aren't one transaction; for a family-sized app
 * the race window is negligible, and array add/remove ops keep concurrent edits mostly merging.)
 */
async function commit(env: Env, body: unknown) {
  const { ops, change } = parseCommit(body)
  const touched = [...new Set(ops.map(op => (op.type === 'set' ? op.person.id : op.id)))]
  const current: People = new Map()
  for (const group of chunks(touched)) {
    const { results } = await env.DB.prepare(`SELECT id, data FROM people WHERE id IN (${group.map(() => '?').join(',')})`)
      .bind(...group).all<{ id: string; data: string }>()
    for (const r of results) current.set(r.id, normalizePerson(r.id, JSON.parse(r.data)))
  }
  for (const op of ops) {
    if (op.type === 'update' && !current.has(op.id) && !ops.some(o => o.type === 'set' && o.person.id === op.id)) {
      return error(409, '此人已被刪除，請重新整理 / This person no longer exists; please reload')
    }
  }

  const diffs = simulate(current, ops)
  for (const d of diffs) if (d.after) checkResult(d.after)

  const statements = diffs.map(({ id, after }) => {
    if (!after) return env.DB.prepare('DELETE FROM people WHERE id = ?').bind(id)
    const { id: _id, ...data } = after
    return env.DB.prepare('INSERT INTO people (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data')
      .bind(id, JSON.stringify(data))
  })
  statements.push(env.DB.prepare('INSERT INTO changes (editor, at, summary, diffs) VALUES (?, ?, ?, ?)')
    .bind(change.editor, Date.now(), change.summary, JSON.stringify(diffs)))
  const results = await env.DB.batch(statements)
  return json({ version: results.at(-1)!.meta.last_row_id })
}

async function login(request: Request, env: Env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (await isRateLimited(env, ip)) return error(429, 'too many attempts')
  const body = await request.json().catch(() => null) as { password?: unknown } | null
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!(await passwordMatches(password, env.FAMILY_PASSWORD))) {
    await recordFailure(env, ip)
    return error(401, 'wrong password')
  }
  return new Response(null, { status: 204, headers: { 'Set-Cookie': await sessionCookie(env) } })
}

async function api(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.FAMILY_PASSWORD) return error(500, 'FAMILY_PASSWORD secret is not set')
  const route = `${request.method} ${path}`

  // JSON-only POSTs can't be forged by other sites without a CORS preflight (plus SameSite=Strict).
  if (request.method === 'POST' && !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return error(415, 'expected application/json')
  }

  if (route === 'POST /api/login') return login(request, env)
  if (route === 'POST /api/logout') return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie } })

  const signedIn = await isSignedIn(request, env)
  if (route === 'GET /api/session') return json({ signedIn })
  if (!signedIn) return error(401, 'not signed in')

  switch (route) {
    case 'GET /api/people': return json(await listPeople(env))
    case 'GET /api/version': return json({ version: await version(env) })
    case 'GET /api/changes': return json({ changes: await listChanges(env) })
    case 'POST /api/commit': return commit(env, await request.json().catch(() => null))
    default: return error(404, 'not found')
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      return await api(request, env, pathname)
    } catch (e) {
      if (e instanceof BadRequest) return error(400, e.message)
      console.error(e)
      return error(500, 'server error')
    }
  },
} satisfies ExportedHandler<Env>
