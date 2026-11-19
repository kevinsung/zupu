import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptyFields, type Person } from '../src/model'
import type { ChangeRecord } from '../src/ops'
import { startWorker } from './worker-env'

let w: Awaited<ReturnType<typeof startWorker>>
beforeAll(async () => { w = await startWorker('correct horse') })
afterAll(() => w.dispose())

const person = (id: string, extra: Partial<Person> = {}): Person =>
  ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, parentKinds: {}, order: 0, ...extra })
const commit = (ops: unknown[], editor = 'Tester') => w.post('/api/commit', { ops, editor, summary: 's' })

describe('auth', () => {
  it('rejects data requests without a session', async () => {
    expect(await (await w.call('/api/session')).json()).toEqual({ signedIn: false })
    expect((await w.call('/api/people')).status).toBe(401)
    expect((await w.call('/api/changes')).status).toBe(401)
    expect((await commit([{ type: 'delete', id: 'x' }])).status).toBe(401)
  })

  it('rejects a wrong password, and rate limits repeated failures per IP', async () => {
    expect((await w.post('/api/login', { password: 'nope' }, '198.51.100.7')).status).toBe(401)
    for (let i = 0; i < 9; i++) await w.post('/api/login', { password: 'nope' }, '198.51.100.7')
    expect((await w.post('/api/login', { password: 'correct horse' }, '198.51.100.7')).status).toBe(429)
    expect(w.cookie).toBe('')
  })

  it('rate limits an IPv6 /64 as one client', async () => {
    for (let i = 1; i <= 10; i++) await w.post('/api/login', { password: 'nope' }, `2001:db8:1:2::${i.toString(16)}`)
    expect((await w.post('/api/login', { password: 'correct horse' }, '2001:db8:1:2:abcd::5')).status).toBe(429)
    expect((await w.post('/api/login', { password: 'correct horse' }, '2001:db8:1:3::1')).status).toBe(204)
  })

  it('requires JSON for POSTs', async () => {
    const res = await w.call('/api/login', { method: 'POST', body: 'password=correct horse', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(415)
  })

  it('signs in with the right password and sets a secure HttpOnly cookie', async () => {
    const res = await w.post('/api/login', { password: 'correct horse' })
    expect(res.status).toBe(204)
    expect(res.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/)
    expect(await (await w.call('/api/session')).json()).toEqual({ signedIn: true })
  })

  it('rejects a tampered cookie', async () => {
    const good = w.cookie
    w.cookie = good.replace(/.$/, c => (c === 'a' ? 'b' : 'a'))
    expect((await w.call('/api/people')).status).toBe(401)
    w.cookie = good
  })

  it('invalidates sessions when the password changes', async () => {
    w.env.FAMILY_PASSWORD = 'new password'
    expect((await w.call('/api/people')).status).toBe(401)
    w.env.FAMILY_PASSWORD = 'correct horse'
    expect((await w.call('/api/people')).status).toBe(200)
  })
})

describe('data', () => {
  it('commits ops atomically, bumps the version and logs server-computed diffs', async () => {
    const before = await (await w.call('/api/people')).json() as { people: Person[]; version: number }
    expect(before.people).toEqual([])
    const res = await commit([
      { type: 'set', person: person('dad', { nameZh: '爸', gender: 'M' }) },
      { type: 'set', person: person('kid', { nameZh: '子', parents: ['dad'] }) },
    ])
    expect(res.status).toBe(200)
    const after = await (await w.call('/api/people')).json() as { people: Person[]; version: number }
    expect(after.version).toBeGreaterThan(before.version)
    expect(after.people.map(p => p.id).sort()).toEqual(['dad', 'kid'])
    expect((await (await w.call('/api/version')).json()).version).toBe(after.version)

    await commit([{ type: 'update', id: 'kid', fields: { birthDate: '1990' } }])
    const { changes } = await (await w.call('/api/changes')).json() as { changes: ChangeRecord[] }
    expect(changes[0].editor).toBe('Tester')
    expect(changes[0].diffs).toEqual([{
      id: 'kid',
      before: person('kid', { nameZh: '子', parents: ['dad'] }),
      after: person('kid', { nameZh: '子', parents: ['dad'], birthDate: '1990' }),
    }])
  })

  it('merges array adds instead of overwriting', async () => {
    await commit([{ type: 'set', person: person('mom', { gender: 'F' }) }])
    await commit([{ type: 'update', id: 'kid', add: { parents: ['mom'] } }])
    const { people } = await (await w.call('/api/people')).json() as { people: Person[] }
    expect(people.find(p => p.id === 'kid')!.parents).toEqual(['dad', 'mom'])
  })

  it('rejects invalid input', async () => {
    const bad: unknown[][] = [
      [{ type: 'set', person: { ...person('x'), gender: 'X' } }],
      [{ type: 'set', person: { ...person('x'), deceased: 'no' } }],
      [{ type: 'update', id: 'kid', fields: { deceased: 'no' } }],
      [{ type: 'set', person: { ...person('x'), birthDate: '90' } }],
      [{ type: 'set', person: { ...person('x'), extra: 1 } }],
      [{ type: 'set', person: { ...person('x'), nameZh: 'a'.repeat(201) } }],
      [{ type: 'set', person: { ...person('x'), address: 'a'.repeat(501) } }],
      [{ type: 'set', person: { ...person('x'), email: 'not an email' } }],
      [{ type: 'update', id: 'kid', fields: { email: 'kid@' } }],
      [{ type: 'update', id: 'kid', fields: { phone: '+1 201 555 0123' } }], // must be E.164
      [{ type: 'update', id: 'kid', fields: { phone: '2015550123' } }],
      [{ type: 'update', id: 'kid', fields: { pinyin: 'Xbio' } }],
      [{ type: 'update', id: 'kid', fields: { pinyin: 'song4 wen2hua2' } }], // must be tidied
      [{ type: 'update', id: 'kid', add: { parents: ['zzz'] } }], // would be three parents
      [{ type: 'update', id: 'kid', add: { spouses: ['kid'] } }], // self
      [{ type: 'update', id: 'kid', fields: { order: 3 } }],
      [{ type: 'update', id: 'bad id!' }],
      [{ type: 'nope' }],
    ]
    for (const ops of bad) expect((await commit(ops)).status, JSON.stringify(ops)).toBe(400)
    expect((await commit([{ type: 'delete', id: 'kid' }], '  ')).status).toBe(400) // editor required
  })

  it('saves pinyin', async () => {
    expect((await commit([{ type: 'update', id: 'kid', fields: { pinyin: 'Sòng Wénhuá' } }])).status).toBe(200)
    const { people } = await (await w.call('/api/people')).json() as { people: Person[] }
    expect(people.find(p => p.id === 'kid')!.pinyin).toBe('Sòng Wénhuá')
  })

  it('saves contact fields', async () => {
    expect((await commit([{ type: 'update', id: 'kid', fields: { email: 'kid@example.com', address: '1 Main St\nTown' } }])).status).toBe(200)
    const { people } = await (await w.call('/api/people')).json() as { people: Person[] }
    expect(people.find(p => p.id === 'kid')).toMatchObject({ email: 'kid@example.com', address: '1 Main St\nTown' })
  })

  it('accepts people without contact fields or marriages (history snapshots from before they existed)', async () => {
    const { pinyin, email, phone, address, line, signal, marriages, parentKinds, ...old } = person('old', { nameZh: '舊' })
    expect((await commit([{ type: 'set', person: old }])).status).toBe(200)
    const { people } = await (await w.call('/api/people')).json() as { people: Person[] }
    expect(people.find(p => p.id === 'old')).toEqual(person('old', { nameZh: '舊' }))
  })

  it('saves deceased, and accepts snapshots that lack it', async () => {
    expect((await commit([{ type: 'update', id: 'kid', fields: { deceased: 'yes' } }])).status).toBe(200)
    const { deceased, ...old } = person('nodec', { nameZh: '舊' })
    expect((await commit([{ type: 'set', person: old }])).status).toBe(200)
    const { people } = await (await w.call('/api/people')).json() as { people: Person[] }
    expect(people.find(p => p.id === 'kid')!.deceased).toBe('yes')
    expect(people.find(p => p.id === 'nodec')).toEqual(person('nodec', { nameZh: '舊' }))
  })

  it('ignores the removed WhatsApp field (old history snapshots and browser tabs)', async () => {
    expect((await commit([{ type: 'set', person: { ...person('wa', { nameZh: '舊' }), whatsapp: '+886912345678' } }])).status).toBe(200)
    expect((await commit([{ type: 'update', id: 'wa', fields: { whatsapp: 'x', nameZh: '新' } }])).status).toBe(200)
    const { people } = await (await w.call('/api/people')).json() as { people: Person[] }
    expect(people.find(p => p.id === 'wa')).toEqual(person('wa', { nameZh: '新' }))
  })

  it('saves parent kinds, rejects bad ones, and drops a kind when the parent is unlinked', async () => {
    expect((await commit([
      { type: 'set', person: person('pk-a') }, { type: 'set', person: person('pk-b') }, { type: 'set', person: person('pk-c') },
      { type: 'set', person: person('pk-kid', { parents: ['pk-a', 'pk-b'], parentKinds: { 'pk-a': 'adoptive' } }) },
    ])).status).toBe(200)
    const get = async () => ((await (await w.call('/api/people')).json()) as { people: Person[] }).people.find(p => p.id === 'pk-kid')!
    expect((await get()).parentKinds).toEqual({ 'pk-a': 'adoptive' })
    const bad: unknown[][] = [
      [{ type: 'update', id: 'pk-kid', parentKinds: { 'pk-b': 'godparent' } }],
      [{ type: 'update', id: 'pk-kid', parentKinds: { 'pk-b': 'foster' } }], // removed kind
      [{ type: 'update', id: 'pk-kid', parentKinds: { 'pk-b': 'step' } }], // removed kind
      [{ type: 'update', id: 'pk-kid', parentKinds: { 'pk-b': '' } }],
      [{ type: 'update', id: 'pk-kid', parentKinds: { 'pk-a': 'adoptive', 'pk-b': 'adoptive', 'pk-c': 'adoptive' } }],
      [{ type: 'update', id: 'pk-kid', parentKinds: [] }],
      [{ type: 'set', person: person('pk-x', { parents: ['pk-a'], parentKinds: { 'pk-c': 'adoptive' } }) }], // not a parent
      [{ type: 'set', person: { ...person('pk-x'), parentKinds: { 'pk-a': null } } }], // null only patches
    ]
    for (const ops of bad) expect((await commit(ops)).status, JSON.stringify(ops)).toBe(400)
    expect((await commit([{ type: 'update', id: 'pk-kid', parentKinds: { 'pk-b': 'adoptive' } }])).status).toBe(200)
    expect((await get()).parentKinds).toEqual({ 'pk-a': 'adoptive', 'pk-b': 'adoptive' })
    expect((await commit([{ type: 'update', id: 'pk-kid', parentKinds: { 'pk-a': null } }])).status).toBe(200)
    expect((await get()).parentKinds).toEqual({ 'pk-b': 'adoptive' })
    expect((await commit([{ type: 'update', id: 'pk-kid', remove: { parents: ['pk-b'] } }])).status).toBe(200)
    expect((await get()).parentKinds).toEqual({})
    // Snapshots from before parentKinds existed lack it.
    const { parentKinds, ...old } = person('pk-old', { parents: ['pk-a'] })
    expect((await commit([{ type: 'set', person: old }])).status).toBe(200)
  })

  it('saves marriages and rejects bad ones', async () => {
    const m = { married: '1985-10', divorced: '', status: 'married' as const }
    expect((await commit([{ type: 'update', id: 'dad', add: { spouses: ['mom'] } }, { type: 'update', id: 'mom', add: { spouses: ['dad'] } }])).status).toBe(200)
    expect((await commit([{ type: 'update', id: 'dad', marriages: { mom: m } }, { type: 'update', id: 'mom', marriages: { dad: m } }])).status).toBe(200)
    let { people } = await (await w.call('/api/people')).json() as { people: Person[] }
    expect(people.find(p => p.id === 'mom')!.marriages).toEqual({ dad: m })
    const bad: unknown[][] = [
      [{ type: 'update', id: 'dad', marriages: { mom: { married: '85' } } }],
      [{ type: 'update', id: 'dad', marriages: { mom: { married: '1985', place: 'x' } } }],
      [{ type: 'update', id: 'dad', marriages: { mom: { status: 'engaged' } } }],
      [{ type: 'update', id: 'dad', marriages: { mom: { married: '1985', status: 'unmarried' } } }],
      [{ type: 'update', id: 'dad', marriages: { 'bad id!': m } }],
      [{ type: 'update', id: 'dad', marriages: [] }],
      [{ type: 'set', person: person('x', { marriages: { mom: m } }) }], // not a spouse
    ]
    for (const ops of bad) expect((await commit(ops)).status, JSON.stringify(ops)).toBe(400)
    expect((await commit([{ type: 'update', id: 'dad', marriages: { mom: null } }])).status).toBe(200)
    ;({ people } = await (await w.call('/api/people')).json() as { people: Person[] })
    expect(people.find(p => p.id === 'dad')!.marriages).toEqual({})

    // Status round-trips; marriages from before it existed still save, as unknown or (with a date) married.
    const unmarried = { married: '', divorced: '', status: 'unmarried' as const }
    expect((await commit([{ type: 'update', id: 'dad', marriages: { mom: unmarried } }, { type: 'update', id: 'mom', marriages: { dad: { married: '1985' } } }])).status).toBe(200)
    ;({ people } = await (await w.call('/api/people')).json() as { people: Person[] })
    expect(people.find(p => p.id === 'dad')!.marriages).toEqual({ mom: unmarried })
    expect(people.find(p => p.id === 'mom')!.marriages).toEqual({ dad: { married: '1985', divorced: '', status: 'married' } })
    expect((await commit([{ type: 'set', person: { ...person('old2', { spouses: ['mom'] }), marriages: { mom: { divorced: '1990' } } } }])).status).toBe(200)

    // Divorced saves with or without dates, and so does married with a divorce date (stored before divorced existed).
    for (const d of [
      { married: '', divorced: '', status: 'divorced' as const },
      { married: '1985', divorced: '1990', status: 'divorced' as const },
      { married: '1985', divorced: '1990', status: 'married' as const },
    ]) {
      expect((await commit([{ type: 'update', id: 'dad', marriages: { mom: d } }])).status, JSON.stringify(d)).toBe(200)
      ;({ people } = await (await w.call('/api/people')).json() as { people: Person[] })
      expect(people.find(p => p.id === 'dad')!.marriages).toEqual({ mom: { ...d, status: 'divorced' } })
    }
    expect((await commit([{ type: 'update', id: 'dad', marriages: { mom: { divorced: '1990', status: 'unmarried' } } }])).status).toBe(400)
  })

  it('refuses to update someone who was deleted meanwhile', async () => {
    expect((await commit([{ type: 'update', id: 'ghost', fields: { nameZh: 'x' } }])).status).toBe(409)
  })

  it('signs out', async () => {
    await w.post('/api/logout', {})
    expect(await (await w.call('/api/session')).json()).toEqual({ signedIn: false })
  })
})
