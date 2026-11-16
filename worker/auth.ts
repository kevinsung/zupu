// Shared-password sessions: a signed, HttpOnly cookie. Changing the FAMILY_PASSWORD secret
// invalidates every existing session, because the signature covers a hash of the password.
import type { Env } from './index'

export const COOKIE = 'ft_session'
const MAX_AGE_S = 180 * 24 * 3600
const FAIL_WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 10

const enc = new TextEncoder()

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Constant-time comparison (both sides hashed first so lengths match). */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  return equalBytes(await sha256(given), await sha256(expected))
}

let cachedSecret: string | null = null

/** Random signing key, generated on first use and kept in D1 so no extra secret needs setting up. */
async function signingSecret(env: Env): Promise<string> {
  if (cachedSecret) return cachedSecret
  const fresh = toHex(crypto.getRandomValues(new Uint8Array(32)))
  await env.DB.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('session_secret', ?)`).bind(fresh).run()
  const row = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'session_secret'`).first<{ value: string }>()
  cachedSecret = row!.value
  return cachedSecret
}

async function sign(env: Env, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(await signingSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const msg = `${exp}.${toHex(await sha256(env.FAMILY_PASSWORD))}`
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg))))
}

export async function sessionCookie(env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S
  return `${COOKIE}=${exp}.${await sign(env, exp)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Strict`
}

export const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`

export async function isSignedIn(request: Request, env: Env): Promise<boolean> {
  const cookie = request.headers.get('Cookie') ?? ''
  const token = cookie.split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (!token) return false
  const [expStr, sig] = token.split('.')
  const exp = Number(expStr)
  if (!sig || !Number.isInteger(exp) || exp < Date.now() / 1000) return false
  return equalBytes(enc.encode(sig), enc.encode(await sign(env, exp)))
}

/** True if this IP has failed too often recently. */
export async function isRateLimited(env: Env, ip: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?`)
    .bind(ip, Date.now() - FAIL_WINDOW_MS).first<{ n: number }>()
  return (row?.n ?? 0) >= MAX_FAILURES
}

export async function recordFailure(env: Env, ip: string) {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO login_failures (ip, at) VALUES (?, ?)`).bind(ip, now),
    env.DB.prepare(`DELETE FROM login_failures WHERE at < ?`).bind(now - 24 * 3600 * 1000),
  ])
}
