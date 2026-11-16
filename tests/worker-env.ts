// Runs the real Worker handler against a throwaway local D1 database (via wrangler/miniflare).
import { readFileSync } from 'node:fs'
import { getPlatformProxy } from 'wrangler'

type Handler = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> }

export async function startWorker(password = 'correct horse') {
  // Non-literal path keeps the Workers-typed module out of the DOM-typed test project.
  const workerPath = '../worker/index'
  const worker = (await import(/* @vite-ignore */ workerPath)).default as Handler
  const proxy = await getPlatformProxy<{ DB: { prepare(sql: string): unknown; batch(s: unknown[]): Promise<unknown> } }>({
    configPath: 'wrangler.jsonc', persist: false,
  })
  const env = { ...proxy.env, FAMILY_PASSWORD: password }

  const migration = readFileSync('migrations/0001_init.sql', 'utf8').replace(/--.*$/gm, '')
  const statements = migration.split(';').map(s => s.trim()).filter(Boolean)
  await env.DB.batch(statements.map(s => env.DB.prepare(s)))

  let cookie = ''
  async function call(path: string, init: RequestInit = {}, ip = '203.0.113.1'): Promise<Response> {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('Cookie', cookie)
    headers.set('CF-Connecting-IP', ip)
    const res = await worker.fetch(new Request(`http://localhost${path}`, { ...init, headers }), env, {})
    const set = res.headers.get('Set-Cookie')
    if (set) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0]
    return res
  }
  const post = (path: string, body: unknown, ip?: string) =>
    call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, ip)

  return {
    env, call, post,
    get cookie() { return cookie },
    set cookie(c: string) { cookie = c },
    dispose: () => proxy.dispose(),
  }
}
