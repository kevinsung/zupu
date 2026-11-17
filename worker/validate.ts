// Strict checks on everything the browser sends, since anyone with the password can call the API.
import { FIELD_KEYS, type Marriage, type Person, type PersonFields, emptyFields, isValidEmail, isValidPartialDate, isValidPhone } from '../src/model'
import type { NewChange, Op, RelList } from '../src/store'

export class BadRequest extends Error {}

const MAX_OPS = 1000
const ID_RE = /^[a-z0-9_-]{1,64}$/i
const MAX_LEN: Partial<Record<string, number>> = { notes: 5000, address: 500 }
// Fields that no longer exist; still present in history snapshots (revert) and stale browser tabs.
const REMOVED_FIELDS = ['whatsapp']
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new BadRequest(msg)
}

function id(v: unknown): string {
  check(typeof v === 'string' && ID_RE.test(v), 'invalid id')
  return v
}

function ids(v: unknown): string[] {
  check(Array.isArray(v) && v.length <= 50, 'invalid id list')
  return v.map(id)
}

function fields(v: unknown, partial: boolean): Partial<PersonFields> {
  check(isObj(v), 'invalid fields')
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (REMOVED_FIELDS.includes(k)) continue
    check((FIELD_KEYS as string[]).includes(k), `unknown field ${k}`)
    check(typeof val === 'string' && val.length <= (MAX_LEN[k] ?? 200), `invalid ${k}`)
    out[k] = val
  }
  // Missing fields default to '' so history snapshots and browser tabs from older versions still work.
  const result = partial ? out : { ...emptyFields(), ...out }
  if ('gender' in out) check(['M', 'F', ''].includes(out.gender), 'invalid gender')
  for (const k of ['birthDate', 'deathDate']) if (k in out) check(isValidPartialDate(out[k]), `invalid ${k}`)
  if ('email' in out) check(isValidEmail(out.email), 'invalid email')
  if ('phone' in out) check(isValidPhone(out.phone), 'invalid phone')
  return result
}

function relLists(v: unknown): Partial<Record<RelList, string[]>> | undefined {
  if (v === undefined) return undefined
  check(isObj(v), 'invalid relationship list')
  const out: Partial<Record<RelList, string[]>> = {}
  for (const [k, val] of Object.entries(v)) {
    check(k === 'parents' || k === 'spouses', `unknown list ${k}`)
    out[k] = ids(val)
  }
  return out
}

function marriage(v: unknown): Marriage {
  check(isObj(v), 'invalid marriage')
  const { married = '', divorced = '', ...rest } = v
  check(Object.keys(rest).length === 0, 'unknown marriage field')
  check(typeof married === 'string' && isValidPartialDate(married), 'invalid married')
  check(typeof divorced === 'string' && isValidPartialDate(divorced), 'invalid divorced')
  return { married, divorced }
}

/** Marriages keyed by spouse id; with `nullable`, null clears one (update patches). */
function marriages(v: unknown, nullable: true): Record<string, Marriage | null>
function marriages(v: unknown, nullable: false): Record<string, Marriage>
function marriages(v: unknown, nullable: boolean): Record<string, Marriage | null> {
  check(isObj(v) && Object.keys(v).length <= 50, 'invalid marriages')
  const out: Record<string, Marriage | null> = {}
  for (const [k, m] of Object.entries(v)) out[id(k)] = nullable && m === null ? null : marriage(m)
  return out
}

function person(v: unknown): Person {
  check(isObj(v), 'invalid person')
  // marriages is optional: history snapshots from before it existed lack it.
  const { id: pid, parents, spouses, marriages: m = {}, order, ...rest } = v
  check(typeof order === 'number' && Number.isFinite(order), 'invalid order')
  return {
    ...(fields(rest, false) as PersonFields),
    id: id(pid), parents: ids(parents), spouses: ids(spouses), marriages: marriages(m, false), order,
  }
}

function op(v: unknown): Op {
  check(isObj(v), 'invalid op')
  switch (v.type) {
    case 'set': return { type: 'set', person: person(v.person) }
    case 'delete': return { type: 'delete', id: id(v.id) }
    case 'update': return {
      type: 'update',
      id: id(v.id),
      fields: v.fields === undefined ? undefined : fields(v.fields, true),
      add: relLists(v.add),
      remove: relLists(v.remove),
      marriages: v.marriages === undefined ? undefined : marriages(v.marriages, true),
    }
    default: throw new BadRequest('invalid op type')
  }
}

export function parseCommit(body: unknown): { ops: Op[]; change: NewChange } {
  check(isObj(body), 'invalid body')
  const { ops, editor, summary } = body
  check(Array.isArray(ops) && ops.length > 0 && ops.length <= MAX_OPS, 'invalid ops')
  check(typeof editor === 'string' && editor.trim().length > 0 && editor.length <= 100, 'editor name required')
  check(typeof summary === 'string' && summary.length <= 1000, 'invalid summary')
  return { ops: ops.map(op), change: { editor: editor.trim(), summary } }
}

/** Sanity checks on the resulting data. */
export function checkResult(p: Person) {
  check(p.parents.length <= 2, 'a person can have at most two parents')
  check(!p.parents.includes(p.id) && !p.spouses.includes(p.id), 'a person cannot be related to themselves')
  check(Object.keys(p.marriages).every(s => p.spouses.includes(s)), 'a marriage must be with a spouse')
}
