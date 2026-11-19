// Hanyu Pinyin for names: checking what was typed against the real syllables, and tidying it up.

/**
 * Every toneless Mandarin syllable in standard Hanyu Pinyin, with ü written out (lü, nüe).
 * Interjection-only syllables (m, n, ng, hm, hng, ê) are left out; no name uses them.
 */
const SYLLABLES = new Set(`
  a ai an ang ao
  ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
  pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu
  ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu
  fa fan fang fei fen feng fo fou fu
  da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo
  ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo
  na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nü nüe
  la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lü lüe
  ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
  ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo
  ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo
  ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun
  qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
  xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun
  zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo
  cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo
  sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo
  ra ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo
  za zai zan zang zao ze zei zen zeng zi zong zou zu zuan zui zun zuo
  ca cai can cang cao ce cen ceng ci cong cou cu cuan cui cun cuo
  sa sai san sang sao se sen seng si song sou su suan sui sun suo
  e ei en eng er o ou
  ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun
  wa wai wan wang wei wen weng wo wu
`.trim().split(/\s+/))

export const PINYIN_SYLLABLE_COUNT = SYLLABLES.size

/** The longest syllable (zhuang, shuang, …) plus an erhua r. */
const MAX_LEN = 7

/** Combining marks for tones 1–4. */
const MARKS = ['̄', '́', '̌', '̀']

/**
 * The standard spelling of a toneless syllable, or null if it isn't one. Also accepts common
 * variants: ü after j, q, x, y (written u), lue/nue for lüe/nüe, and an erhua r (huar).
 */
function syllable(s: string): string | null {
  if (SYLLABLES.has(s)) return s
  if (/^[jqxy]/.test(s) && s.includes('ü')) return syllable(s.replace('ü', 'u'))
  if (s === 'lue' || s === 'nue') return `${s[0]}üe`
  if (s.endsWith('r')) {
    const base = SYLLABLES.has(s.slice(0, -1)) ? s.slice(0, -1) : null
    if (base && base !== 'er') return `${base}r`
  }
  return null
}

/** Which letter takes the tone mark: a or e, else the o of ou, else the last vowel. */
function markIndex(s: string): number {
  for (const v of ['a', 'e', 'ou']) if (s.includes(v)) return s.indexOf(v)
  for (let i = s.length - 1; i >= 0; i--) if ('iouü'.includes(s[i])) return i
  return -1
}

function withTone(s: string, tone: number): string {
  const i = markIndex(s)
  if (tone < 1 || tone > 4 || i < 0) return s
  return (s.slice(0, i + 1) + MARKS[tone - 1] + s.slice(i + 1)).normalize('NFC')
}

/** A piece of a word between explicit breaks: letters with any tone mark on them, and where tone digits fell. */
interface Lexed { letters: string; marks: number[]; digits: Map<number, number> }

/** null if it has anything but letters, tone marks, ü spellings (ü, v, u:) and tone digits. */
function lex(piece: string): Lexed | null {
  let letters = ''
  const marks: number[] = []
  const digits = new Map<number, number>()
  for (const c of piece.normalize('NFD').toLowerCase()) {
    const last = letters.length - 1
    if (/[a-z]/.test(c)) { letters += c === 'v' ? 'ü' : c; marks.push(0) }
    else if ((c === '̈' || c === ':') && letters[last] === 'u') letters = `${letters.slice(0, last)}ü`
    else if (MARKS.includes(c) && last >= 0 && !marks[last]) marks[last] = MARKS.indexOf(c) + 1
    // A digit ends a syllable, so it can't follow another digit or begin the piece.
    else if (/[0-5]/.test(c) && last >= 0 && !digits.has(letters.length)) digits.set(letters.length, +c)
    else return null
  }
  return letters ? { letters, marks, digits } : null
}

interface Split { syllables: string[]; ways: number }

/**
 * Splits a piece into syllables, each with at most one tone and ending wherever a tone digit
 * was typed. Returns the split with the fewest syllables (so xian is one syllable, not xi'an),
 * tones applied, and how many splits there are (capped at 2); null if there's none.
 */
function split({ letters, marks, digits }: Lexed): Split | null {
  const n = letters.length
  const memo = new Map<number, Split | null>()
  const from = (i: number): Split | null => {
    if (i === n) return { syllables: [], ways: 1 }
    if (memo.has(i)) return memo.get(i)!
    let best: Split | null = null
    let ways = 0
    for (let j = i + 1; j <= Math.min(n, i + MAX_LEN); j++) {
      const base = syllable(letters.slice(i, j))
      if (base) {
        const tones = [...marks.slice(i, j).filter(Boolean), ...(digits.has(j) ? [digits.get(j)!] : [])]
        const rest = tones.length <= 1 ? from(j) : null
        if (rest) {
          ways += rest.ways
          if (!best || rest.syllables.length + 1 < best.syllables.length) best = { syllables: [withTone(base, tones[0] ?? 0), ...rest.syllables], ways: 0 }
        }
      }
      // A digit marks the end of a syllable, so no syllable can run past it.
      if (digits.has(j)) break
    }
    const result = best && { syllables: best.syllables, ways: Math.min(ways, 2) }
    memo.set(i, result)
    return result
  }
  return from(0)
}

/**
 * Tidies a word: tones as marks on the right vowels, an apostrophe before a syllable starting
 * with a, o or e (Xī'ān) where the split is certain, and a capital first letter. Apostrophes and
 * hyphens typed inside the word are kept as breaks. null if it isn't pinyin.
 */
function tidyWord(word: string): string | null {
  const parts = word.split(/(['’-])/)
  let out = ''
  for (let k = 0; k < parts.length; k++) {
    if (k % 2) { out += parts[k] === '-' ? '-' : "'"; continue }
    const lexed = lex(parts[k])
    const s = lexed && split(lexed)
    if (!s) return null
    out += s.ways === 1 ? s.syllables.map((x, i) => (i && /^[aāáǎàoōóǒòeēéěè]/.test(x) ? `'${x}` : x)).join('') : s.syllables.join('')
  }
  return out.charAt(0).toUpperCase() + out.slice(1)
}

/**
 * Checks and tidies typed pinyin. Tones are optional; tone numbers (Song4 Wen2hua2) become marks
 * (Sòng Wénhuá). Words stay as typed, since only the person entering the name knows where the
 * surname ends (Ōuyáng Xiū, Sòng Lín Wénhuá). Returns the first word that isn't pinyin as `bad`.
 */
export function parsePinyin(s: string): { value: string } | { bad: string } {
  const words = s.normalize('NFKC').trim().split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const word of words) {
    const tidy = tidyWord(word)
    if (tidy === null) return { bad: word }
    out.push(tidy)
  }
  return { value: out.join(' ') }
}

/** Blank, or pinyin already in the tidied form parsePinyin gives. */
export function isValidPinyin(s: string): boolean {
  if (s === '') return true
  const r = parsePinyin(s)
  return 'value' in r && r.value === s
}

/** Pinyin reduced to bare letters for searching: no tones, spaces, breaks or case; v and ü as u. */
export function foldPinyin(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/v/g, 'u').replace(/[^a-z]/g, '')
}
