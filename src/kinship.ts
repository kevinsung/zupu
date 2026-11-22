import type { People, Person } from './model'
import { byBirth, childrenIndex, datesDecide, partnerIds } from './model'

export interface Kin {
  /** How you'd refer to this relative in everyday speech (not always what you'd call them to their face), e.g. '堂哥', '伯父或叔叔', '爸爸的表哥' */
  zh: string
  /** Natural English term, e.g. 'older cousin', 'uncle', "father's cousin" */
  en: string
  /** English description of the path, e.g. "father's brother's son"; '' when it wouldn't add anything (single-token path, or same as en). */
  gloss: string
}

/** How `meId` would refer to `targetId` in everyday speech; 'self' when they're the same person; null if either is missing or there's no connection within the search cap. */
export function kinTerm(people: People, meId: string, targetId: string): Kin | 'self' | null {
  if (!people.has(meId) || !people.has(targetId)) return null
  if (meId === targetId) return 'self'
  const s = searchFor(people, meId)
  if (s.terms.has(targetId)) return s.terms.get(targetId)!
  const kin = compute(people, s.reach, meId, targetId)
  s.terms.set(targetId, kin)
  return kin
}

// ---------------------------------------------------------------------------------------------
// Path search

type Edge = 'up' | 'down' | 'partner'
interface Reach { prev: string, edge: Edge, cost: number }
interface Search { reach: Map<string, Reach>, terms: Map<string, Kin | null> }

const MAX_EDGES = 10
const STEP = 1000 // cost of an edge; a partner edge costs one more, so fewer partner edges win among shortest paths

/** Keyed by the People map (the store makes a new one on each update), then by who "me" is. */
const cache = new WeakMap<People, Map<string, Search>>()

function searchFor(people: People, meId: string): Search {
  let byMe = cache.get(people)
  if (!byMe) cache.set(people, (byMe = new Map()))
  let s = byMe.get(meId)
  if (!s) byMe.set(meId, (s = { reach: bfs(people, meId), terms: new Map() }))
  return s
}

/** How far someone is from "me": kinship steps (an up then a down is one sibling step, as in the terms) and how many are partner links. */
export interface Distance { steps: number, partners: number }

/** Distance along the cached kinship path from `meId` to everyone within MAX_EDGES (0 for `meId`); anyone further, or not connected, is absent. */
export function kinDistance(people: People, meId: string): Map<string, Distance> {
  if (!people.has(meId)) return new Map()
  const reach = searchFor(people, meId).reach
  return new Map([...reach.keys()].map(id => {
    const edges = pathTo(reach, id).edges
    return [id, { steps: tokenCount(edges), partners: edges.filter(e => e === 'partner').length }]
  }))
}

/** The people and edges from me to `targetId`, which must be in `reach`. */
function pathTo(reach: Map<string, Reach>, targetId: string) {
  const ids = [targetId]
  const edges: Edge[] = []
  for (let r = reach.get(targetId)!; r.prev; r = reach.get(r.prev)!) {
    ids.push(r.prev)
    edges.push(r.edge)
  }
  return { ids: ids.reverse(), edges: edges.reverse() }
}

const genderRank = (p: Person) => (p.gender === 'M' ? 0 : p.gender === 'F' ? 1 : 2)

/** Cheapest paths from `meId` to everyone within MAX_EDGES: fewest edges, then fewest partner edges, then discovery order. */
function bfs(people: People, meId: string): Map<string, Reach> {
  const kids = childrenIndex(people)
  const reach = new Map<string, Reach>([[meId, { prev: '', edge: 'partner', cost: 0 }]])
  const open = [meId]
  while (open.length > 0) {
    let best = 0
    for (let i = 1; i < open.length; i++) if (reach.get(open[i]!)!.cost < reach.get(open[best]!)!.cost) best = i
    const id = open.splice(best, 1)[0]!
    const p = people.get(id)!
    const cost = reach.get(id)!.cost
    const visit = (to: string, edge: Edge) => {
      const c = cost + STEP + (edge === 'partner' ? 1 : 0)
      if (c >= (MAX_EDGES + 1) * STEP) return
      const old = reach.get(to)
      if (old && old.cost <= c) return
      if (!old) open.push(to)
      reach.set(to, { prev: id, edge, cost: c })
    }
    p.parents.filter(x => people.has(x))
      .sort((a, b) => genderRank(people.get(a)!) - genderRank(people.get(b)!) || (a < b ? -1 : a > b ? 1 : 0))
      .forEach(x => visit(x, 'up'))
    partnerIds(people, p).forEach(x => visit(x, 'partner'))
    ;[...(kids.get(id) ?? [])].sort().forEach(x => visit(x, 'down'))
  }
  return reach
}

// ---------------------------------------------------------------------------------------------
// Tokens

/** F/M/P father/mother/parent, S/D/C son/daughter/child, H/W/X husband/wife/spouse, B/Z/G brother/sister/sibling. */
const LETTERS: Record<Edge | 'sibling', [string, string, string]> = {
  up: ['F', 'M', 'P'],
  down: ['S', 'D', 'C'],
  partner: ['H', 'W', 'X'],
  sibling: ['B', 'Z', 'G'],
}

function letter(kind: Edge | 'sibling', p: Person): string {
  return LETTERS[kind][p.gender === 'M' ? 0 : p.gender === 'F' ? 1 : 2]
}

/** An up then a down is one sibling token. */
const siblingAt = (edges: Edge[], i: number) => edges[i] === 'up' && edges[i + 1] === 'down'

/** How many tokens `tokenize` makes of a path. */
function tokenCount(edges: Edge[]): number {
  let n = 0
  for (let i = 0; i < edges.length; i += siblingAt(edges, i) ? 2 : 1) n++
  return n
}

/** Tokens for a path, and the people they land on (with `me` first). */
function tokenize(people: People, ids: string[], edges: Edge[]) {
  const tokens: string[] = []
  const persons: Person[] = [people.get(ids[0]!)!]
  for (let i = 0; i < edges.length;) {
    const sibling = siblingAt(edges, i)
    const to = people.get(ids[sibling ? i + 2 : i + 1]!)!
    tokens.push(letter(sibling ? 'sibling' : edges[i]!, to))
    persons.push(to)
    i += sibling ? 2 : 1
  }
  return { tokens, persons }
}

/** Whether `a` is older than `b`; null when nothing decides. Siblings use birth order (set by hand if need be), others need dates. */
function older(a: Person, b: Person): boolean | null {
  if (a.parents.some(p => b.parents.includes(p))) {
    const c = byBirth(a, b)
    return c < 0 ? true : c > 0 ? false : null
  }
  return datesDecide(a, b) ? a.birthDate < b.birthDate : null
}

// ---------------------------------------------------------------------------------------------
// Term table

type Pair = [zh: string, en: string]

let zhTerm = (zh: string) => zh
/** Sets how each table term's Chinese is written (identity by default: Traditional); set before any kinTerm call. */
export function setZhTerm(fn: (zh: string) => string) { zhTerm = fn }
type Cmp = [number, number]
/** A term that depends on the people involved; null means the row doesn't apply, so matching moves on. */
type Dyn = (persons: Person[], people: People) => Pair | null
/**
 * A path of tokens joined by '.', where '[FM]' allows either letter. Either a single term (or a
 * function giving one), or a `cmp` pair of indices into the segment's people (0 = where the segment
 * starts) followed by the terms for when person i is older than person j, and when younger. The first
 * matching row wins. 堂 rows only apply to siblings of the same father's line (see sameLine).
 */
type Row = [path: string, term: Pair | Dyn] | [path: string, cmp: Cmp, older: Pair, younger: Pair]

/** Whether the endings of marriages and the dates of births make `s` a step relation of child `k` through `k`'s parent `p`. */
function stepRelation(k: Person, p: Person, s: Person, people: People): 'step' | 'former' | null {
  if (k.parents.includes(s.id)) return null
  const o = k.parents.filter(id => id !== p.id).map(id => people.get(id)).find(x => x)
  const mS = p.marriages[s.id]
  const startO = o ? p.marriages[o.id]?.married ?? '' : ''
  // Remarried only after the child's other parent was out of the picture
  if (mS?.married && (o ? before(ended(p, o), mS.married) : before(k.birthDate, mS.married))) return 'step'
  // Parted before the child was born or before p's partnership with the other parent began
  const endS = ended(p, s)
  if (endS && (before(endS, k.birthDate) || before(endS, startO))) return 'former'
  return null // overlapping (concubines) or undated: don't guess
}

/** Both dates set and they decide (same rule as datesDecide), and `a` is the earlier. */
const before = (a: string, b: string) => datesDecide({ birthDate: a }, { birthDate: b }) && a < b

/** When p's marriage to q ended: the divorce, else the earlier death; '' if unknown. */
function ended(p: Person, q: Person): string {
  const d = p.marriages[q.id]?.divorced
  if (d) return d
  const [x, y] = [p.deathDate, q.deathDate]
  if (!x || !y) return x || y
  return before(x, y) ? x : before(y, x) ? y : ''
}

/** Step or former relation as a row term; `childFirst` when `me` is the child (else me is the parent's spouse). */
const stepTerm = (childFirst: boolean, step: Pair, former: Pair): Dyn => (ps, people) => {
  const r = childFirst ? stepRelation(ps[0]!, ps[1]!, ps[2]!, people) : stepRelation(ps[2]!, ps[1]!, ps[0]!, people)
  return r === 'step' ? step : r === 'former' ? former : null
}

/**
 * Which word to use: the most common spoken term in Taiwan Mandarin for referring to the relative
 * (爸爸, 叔叔, 伯父, 外婆, 媳婦). Where the spoken word differs from family to family (a
 * great-grandfather is 阿祖 in families that also speak Taiwanese, 阿太 in Hakka ones, 太爺爺 in ones
 * from northern China) or there is none, the standard term (曾祖父). The one exception is 丈夫/妻子
 * over the spoken 先生/太太 or 老公/老婆: on a card, 先生 alone could read as "Mr." or "teacher",
 * and 老公/老婆 is too casual.
 */
const ROWS: Row[] = [
  // Single tokens, gendered and neutral
  // (An unknown-gender parent, child or sibling is both readings: '爸爸或媽媽'; 'X' reads as one person.)
  ['F', ['爸爸', 'father']], ['M', ['媽媽', 'mother']],
  ['S', ['兒子', 'son']], ['D', ['女兒', 'daughter']],
  ['H', ['丈夫', 'husband']], ['W', ['妻子', 'wife']], ['X', ['配偶', 'spouse']],
  ['B', [1, 0], ['哥哥', 'older brother'], ['弟弟', 'younger brother']],
  ['Z', [1, 0], ['姊姊', 'older sister'], ['妹妹', 'younger sister']],

  // Ancestors
  ['F.F', ['爺爺', 'grandfather']], ['F.M', ['奶奶', 'grandmother']],
  ['M.F', ['外公', 'grandfather']], ['M.M', ['外婆', 'grandmother']],
  ['F.F.F', ['曾祖父', 'great-grandfather']], ['F.F.M', ['曾祖母', 'great-grandmother']],
  ['F.M.F', ['曾外祖父', 'great-grandfather']], ['F.M.M', ['曾外祖母', 'great-grandmother']],
  ['M.[FM].F', ['外曾祖父', 'great-grandfather']], ['M.[FM].M', ['外曾祖母', 'great-grandmother']],
  ['F.F.F.F', ['高祖父', 'great-great-grandfather']], ['F.F.F.M', ['高祖母', 'great-great-grandmother']],

  // Parents' siblings and their spouses
  ['F.B', [2, 1], ['伯父', 'uncle'], ['叔叔', 'uncle']],
  ['F.B.W', [2, 1], ['伯母', 'aunt'], ['嬸嬸', 'aunt']],
  ['F.Z', ['姑姑', 'aunt']], ['F.Z.H', ['姑丈', 'uncle']],
  ['M.B', ['舅舅', 'uncle']], ['M.B.W', ['舅媽', 'aunt']],
  ['M.Z', ['阿姨', 'aunt']], ['M.Z.H', ['姨丈', 'uncle']],

  // Grandparents' siblings and their spouses
  ['[FM].F.B', [3, 2], ['伯公', 'great-uncle'], ['叔公', 'great-uncle']],
  ['[FM].F.B.W', [3, 2], ['伯婆', 'great-aunt'], ['叔婆', 'great-aunt']],
  ['[FM].F.Z', ['姑婆', 'great-aunt']], ['[FM].F.Z.H', ['姑丈公', 'great-uncle']],
  ['[FM].M.B', ['舅公', 'great-uncle']], ['[FM].M.B.W', ['舅婆', 'great-aunt']],
  ['[FM].M.Z', ['姨婆', 'great-aunt']], ['[FM].M.Z.H', ['姨丈公', 'great-uncle']],

  // Siblings' spouses
  ['B.W', [1, 0], ['嫂嫂', 'sister-in-law'], ['弟媳', 'sister-in-law']],
  ['Z.H', [1, 0], ['姊夫', 'brother-in-law'], ['妹夫', 'brother-in-law']],

  // Siblings' descendants
  ['B.S', ['姪子', 'nephew']], ['B.D', ['姪女', 'niece']],
  ['Z.S', ['外甥', 'nephew']], ['Z.D', ['外甥女', 'niece']],
  ['B.S.W', ['姪媳婦', "nephew's wife"]], ['B.D.H', ['姪女婿', "niece's husband"]],
  ['Z.S.W', ['外甥媳婦', "nephew's wife"]], ['Z.D.H', ['外甥女婿', "niece's husband"]],
  ['B.S.S', ['姪孫', 'grandnephew']], ['B.S.D', ['姪孫女', 'grandniece']],
  ['B.D.S', ['外姪孫', 'grandnephew']], ['B.D.D', ['外姪孫女', 'grandniece']],
  ['Z.[SD].S', ['外甥孫', 'grandnephew']], ['Z.[SD].D', ['外甥孫女', 'grandniece']],

  // Cousins (older or younger than me)
  ['F.B.S', [3, 0], ['堂哥', 'older cousin'], ['堂弟', 'younger cousin']],
  ['F.B.D', [3, 0], ['堂姊', 'older cousin'], ['堂妹', 'younger cousin']],
  ['[FM].[BZ].S', [3, 0], ['表哥', 'older cousin'], ['表弟', 'younger cousin']],
  ['[FM].[BZ].D', [3, 0], ['表姊', 'older cousin'], ['表妹', 'younger cousin']],

  // Cousins' spouses (older or younger than me)
  ['F.B.S.W', [3, 0], ['堂嫂', "cousin's wife"], ['堂弟媳', "cousin's wife"]],
  ['F.B.D.H', [3, 0], ['堂姊夫', "cousin's husband"], ['堂妹夫', "cousin's husband"]],
  ['[FM].[BZ].S.W', [3, 0], ['表嫂', "cousin's wife"], ['表弟媳', "cousin's wife"]],
  ['[FM].[BZ].D.H', [3, 0], ['表姊夫', "cousin's husband"], ['表妹夫', "cousin's husband"]],

  // Cousins' children
  ['F.B.S.S', ['堂姪', "cousin's son"]], ['F.B.S.D', ['堂姪女', "cousin's daughter"]],
  ['F.B.D.S', ['堂外甥', "cousin's son"]], ['F.B.D.D', ['堂外甥女', "cousin's daughter"]],
  ['[FM].[BZ].S.S', ['表姪', "cousin's son"]], ['[FM].[BZ].S.D', ['表姪女', "cousin's daughter"]],
  ['[FM].[BZ].D.S', ['表外甥', "cousin's son"]], ['[FM].[BZ].D.D', ['表外甥女', "cousin's daughter"]],

  // Parents' cousins (older or younger than the parent)
  ['F.F.B.S', [4, 1], ['堂伯', "father's cousin"], ['堂叔', "father's cousin"]],
  ['F.F.B.D', ['堂姑', "father's cousin"]],
  ['F.[FM].[BZ].S', [4, 1], ['表伯', "father's cousin"], ['表叔', "father's cousin"]],
  ['F.[FM].[BZ].D', ['表姑', "father's cousin"]],
  ['M.F.B.S', ['堂舅', "mother's cousin"]], ['M.F.B.D', ['堂姨', "mother's cousin"]],
  ['M.[FM].[BZ].S', ['表舅', "mother's cousin"]], ['M.[FM].[BZ].D', ['表姨', "mother's cousin"]],

  // Descendants
  ['S.S', ['孫子', 'grandson']], ['S.D', ['孫女', 'granddaughter']],
  ['D.S', ['外孫', 'grandson']], ['D.D', ['外孫女', 'granddaughter']],
  ['S.S.S', ['曾孫', 'great-grandson']], ['S.S.D', ['曾孫女', 'great-granddaughter']],
  ['S.D.S', ['曾外孫', 'great-grandson']], ['S.D.D', ['曾外孫女', 'great-granddaughter']],
  ['D.S.S', ['外曾孫', 'great-grandson']], ['D.S.D', ['外曾孫女', 'great-granddaughter']],
  ['D.D.S', ['重外孫', 'great-grandson']], ['D.D.D', ['重外孫女', 'great-granddaughter']],

  // Descendants' spouses, and the in-laws of children
  ['S.W', ['媳婦', 'daughter-in-law']], ['D.H', ['女婿', 'son-in-law']],
  ['S.S.W', ['孫媳婦', 'granddaughter-in-law']], ['S.D.H', ['孫女婿', 'grandson-in-law']],
  ['D.S.W', ['外孫媳婦', 'granddaughter-in-law']], ['D.D.H', ['外孫女婿', 'grandson-in-law']],
  ['S.W.F', ['親家公', "child's father-in-law"]], ['D.H.F', ['親家公', "child's father-in-law"]],
  ['S.W.M', ['親家母', "child's mother-in-law"]], ['D.H.M', ['親家母', "child's mother-in-law"]],

  // Spouse's family
  ['H.F', ['公公', 'father-in-law']], ['H.M', ['婆婆', 'mother-in-law']],
  ['W.F', ['岳父', 'father-in-law']], ['W.M', ['岳母', 'mother-in-law']],
  ['H.B', [2, 1], ['大伯', 'brother-in-law'], ['小叔', 'brother-in-law']],
  ['H.Z', [2, 1], ['大姑', 'sister-in-law'], ['小姑', 'sister-in-law']],
  ['W.B', [2, 1], ['大舅子', 'brother-in-law'], ['小舅子', 'brother-in-law']],
  ['W.Z', [2, 1], ['大姨子', 'sister-in-law'], ['小姨子', 'sister-in-law']],
  ['H.B.W', [2, 1], ['大嫂', 'sister-in-law'], ['小嬸', 'sister-in-law']], ['W.Z.H', ['連襟', 'brother-in-law']],
  ['H.B.S', ['姪子', 'nephew']], ['H.B.D', ['姪女', 'niece']],
  ['H.Z.S', ['外甥', 'nephew']], ['H.Z.D', ['外甥女', 'niece']],
  ['W.B.S', ['內姪', 'nephew']], ['W.B.D', ['內姪女', 'niece']],
  ['W.Z.S', ['外甥', 'nephew']], ['W.Z.D', ['外甥女', 'niece']],

  // Steps, or former spouses of a parent, by the dates; otherwise composed ('爸爸的妻子')
  ['F.W', stepTerm(true, ['繼母', 'stepmother'], ['爸爸的前妻', "father's former wife"])],
  ['M.H', stepTerm(true, ['繼父', 'stepfather'], ['媽媽的前夫', "mother's former husband"])],
  ['H.S', stepTerm(false, ['繼子', 'stepson'], ['前夫的兒子', "former husband's son"])],
  ['H.D', stepTerm(false, ['繼女', 'stepdaughter'], ['前夫的女兒', "former husband's daughter"])],
  ['W.S', stepTerm(false, ['繼子', 'stepson'], ['前妻的兒子', "former wife's son"])],
  ['W.D', stepTerm(false, ['繼女', 'stepdaughter'], ['前妻的女兒', "former wife's daughter"])],
]

/** `paternal` lists the sibling tokens (by position) that must be of the same father's line. */
interface Entry { pat: string[][], paternal: number[], cmp?: Cmp, older?: Pair, younger?: Pair, term?: Pair | Dyn }

const ENTRIES: Entry[] = ROWS.map((r): Entry => {
  const pat = r[0].split('.').map(t => (t.startsWith('[') ? [...t.slice(1, -1)] : [t]))
  const zhs = r.length === 4 ? [r[2][0], r[3][0]] : typeof r[1] === 'function' ? [] : [r[1][0]]
  // 堂 is the same paternal line, so a father's maternal half-brother's son is a 表 cousin
  const paternal = zhs.some(z => z.startsWith('堂')) ? pat.flatMap((set, i) => (set.every(l => 'BZ'.includes(l)) ? [i] : [])) : []
  return r.length === 2 ? { pat, paternal, term: r[1] } : { pat, paternal, cmp: r[1], older: r[2], younger: r[3] }
})
const MAX_LEN = Math.max(...ENTRIES.map(e => e.pat.length))

/**
 * Whether two siblings may be of the same father's line: they share a parent not known to be a
 * woman, or they share only a mother and neither has a father recorded (a sparse tree, not proof of
 * different fathers). Unknown gender counts as possibly the father.
 */
function sameLine(a: Person, b: Person, people: People): boolean {
  const maybeMale = (id: string) => people.get(id)?.gender !== 'F'
  const shared = a.parents.filter(id => b.parents.includes(id))
  if (shared.some(maybeMale)) return true
  return ![...a.parents, ...b.parents].some(id => !shared.includes(id) && people.has(id) && maybeMale(id))
}

type Hit = { term: Pair } | { cmp: Cmp, older: Pair, younger: Pair }

/** The first row matching these letters (for the people they land on, `persons` starting where the segment does) that applies. */
function lookup(letters: string[], persons: Person[], people: People): Hit | null {
  for (const e of ENTRIES) {
    if (e.pat.length !== letters.length || !e.pat.every((set, i) => set.includes(letters[i]!))) continue
    if (!e.paternal.every(i => sameLine(persons[i]!, persons[i + 1]!, people))) continue
    if (!e.cmp) {
      const t = typeof e.term === 'function' ? e.term(persons, people) : e.term!
      if (t) return { term: t }
    } else return { cmp: e.cmp, older: e.older!, younger: e.younger! }
  }
  return null
}

const EXPAND: Record<string, string[]> = { P: ['F', 'M'], C: ['S', 'D'], G: ['B', 'Z'], X: ['H', 'W'] }

function combos(tokens: string[]): string[][] {
  return tokens.reduce<string[][]>((acc, t) => acc.flatMap(a => (EXPAND[t] ?? [t]).map(x => [...a, x])), [[]])
}

/**
 * Terms (zh to en) for a segment: matched as written if the table has it (the neutral single tokens),
 * otherwise with each unknown-gender token and each undecided age comparison tried both ways.
 * `persons` starts at the segment's first person.
 */
function resolve(tokens: string[], persons: Person[], people: People): Map<string, string> | null {
  const out = new Map<string, string>()
  const put = (p: Pair) => { const z = zhTerm(p[0]); if (!out.has(z)) out.set(z, p[1]) }
  const add = (letters: string[]): boolean => {
    const h = lookup(letters, persons, people)
    if (!h) return false
    if ('term' in h) { put(h.term); return true }
    const o = older(persons[h.cmp[0]]!, persons[h.cmp[1]]!)
    if (o !== false) put(h.older)
    if (o !== true) put(h.younger)
    return true
  }
  if (lookup(tokens, persons, people)) add(tokens)
  // Every reading must have a term: a son's spouse of unknown gender isn't simply 媳婦 because the table lacks a word for a son's husband.
  else if (!combos(tokens).every(add)) return null
  return out.size > 0 ? out : null
}

const plain = (en: string) => en.replace(/(older|younger) /g, '')
const prefix = (en: string) => /^(older|younger) /.exec(en)?.[0] ?? ''

/** One term from up to two candidates; null if there are more. */
function combine(m: Map<string, string>): Pair | null {
  if (m.size > 2) return null
  const en = [...new Set(m.values())]
  let e = en.join(' or ')
  if (en.length === 2) {
    const [a, b] = [plain(en[0]!), plain(en[1]!)]
    if (a === b) e = a
    else if (prefix(en[0]!) && prefix(en[0]!) === prefix(en[1]!)) e = `${prefix(en[0]!)}${a} or ${b}`
  }
  return [[...m.keys()].join('或'), e]
}

/** Longest table matches, one after another: '堂伯的兒子'. */
function compose(tokens: string[], persons: Person[], people: People): Pair {
  const zh: string[] = []
  const en: string[] = []
  for (let i = 0; i < tokens.length;) {
    let used = 1
    let term: Pair | null = null
    for (let len = Math.min(MAX_LEN, tokens.length - i); len >= 1 && !term; len--) {
      const r = resolve(tokens.slice(i, i + len), persons.slice(i), people)
      if (!r || (len > 1 && r.size > 1)) continue
      term = combine(r)
      used = len
    }
    const last = i + used === tokens.length
    // Only a sibling of unknown gender and age gets here without a term (four candidates)
    term ??= [zhTerm('兄弟姊妹'), 'sibling']
    zh.push(term[0])
    en.push(last ? term[1] : plain(term[1]))
    i += used
  }
  return [zh.join('的'), en.join("'s ")]
}

const WORD: Record<string, string> = {
  F: 'father', M: 'mother', P: 'parent', S: 'son', D: 'daughter', C: 'child',
  B: 'brother', Z: 'sister', G: 'sibling', H: 'husband', W: 'wife', X: 'spouse',
}

function gloss(tokens: string[], persons: Person[]): string {
  return tokens.map((t, i) => {
    if (!'BZG'.includes(t)) return WORD[t]!
    const o = older(persons[i + 1]!, persons[i]!)
    return (o === null ? '' : o ? 'older ' : 'younger ') + WORD[t]
  }).join("'s ")
}

function compute(people: People, reach: Map<string, Reach>, meId: string, targetId: string): Kin | null {
  if (!reach.has(targetId)) return null
  const { ids, edges } = pathTo(reach, targetId)
  if (ids[0] !== meId) return null
  const { tokens, persons } = tokenize(people, ids, edges)
  let term: Pair | null = null
  if (tokens.length <= MAX_LEN) {
    const r = resolve(tokens, persons, people)
    term = r && combine(r)
  }
  term ??= compose(tokens, persons, people)
  const g = tokens.length > 1 ? gloss(tokens, persons) : ''
  return { zh: term[0], en: term[1], gloss: g === term[1] ? '' : g }
}
