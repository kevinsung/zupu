import { describe, expect, it } from 'vitest'
import { type People, type Person, emptyFields } from '../src/model'
import { kinTerm } from '../src/kinship'

const person = (id: string, extra: Partial<Person> = {}): Person =>
  ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, parentKinds: {}, order: 0, ...extra })

const M = 'M' as const
const F = 'F' as const

/** Fathers' side, mothers' side, me and my siblings, cousins, in-laws and descendants. */
function family(): Person[] {
  return [
    person('ggf', { gender: M }),
    person('ggm', { gender: F, spouses: ['ggf'] }),
    person('gf', { gender: M, birthDate: '1930', parents: ['ggf', 'ggm'], spouses: ['gm'] }),
    person('gbro', { gender: M, birthDate: '1925', parents: ['ggf', 'ggm'] }),
    person('gbs', { gender: M, birthDate: '1952', parents: ['gbro'] }),
    person('gbss', { gender: M, birthDate: '1980', parents: ['gbs'] }),
    person('gm', { gender: F, birthDate: '1932', spouses: ['gf'] }),
    person('unc1', { gender: M, birthDate: '1955', parents: ['gf', 'gm'], spouses: ['aunt1w'] }),
    person('dad', { gender: M, birthDate: '1958', parents: ['gf', 'gm'], spouses: ['mom', 'mom2'] }),
    person('unc2', { gender: M, birthDate: '1962', parents: ['gf', 'gm'], spouses: ['aunt2w'] }),
    person('aunt', { gender: F, birthDate: '1965', parents: ['gf', 'gm'], spouses: ['auntH'] }),
    person('aunt1w', { gender: F, spouses: ['unc1'] }),
    person('aunt2w', { gender: F, spouses: ['unc2'] }),
    person('auntH', { gender: M, spouses: ['aunt'] }),
    person('mgf', { gender: M, spouses: ['mgm'] }),
    person('mgm', { gender: F, spouses: ['mgf'] }),
    person('mom', { gender: F, birthDate: '1960', parents: ['mgf', 'mgm'], spouses: ['dad'] }),
    person('mbro', { gender: M, birthDate: '1963', parents: ['mgf', 'mgm'], spouses: ['mbroW'] }),
    person('msis', { gender: F, birthDate: '1966', parents: ['mgf', 'mgm'], spouses: ['msisH'] }),
    person('mbroW', { gender: F, spouses: ['mbro'] }),
    person('msisH', { gender: M, spouses: ['msis'] }),
    person('mom2', { gender: F, spouses: ['dad'] }),
    person('half', { gender: M, birthDate: '1982', parents: ['dad', 'mom2'] }),
    person('bro', { gender: M, birthDate: '1985', parents: ['dad', 'mom'], spouses: ['broW'] }),
    person('broW', { gender: F, spouses: ['bro'] }),
    person('me', { gender: M, birthDate: '1990', parents: ['dad', 'mom'], spouses: ['wife'] }),
    person('sis', { gender: F, birthDate: '1993', parents: ['dad', 'mom'], spouses: ['sisH'] }),
    person('sisH', { gender: M, spouses: ['sis'] }),
    person('ybro', { gender: M, birthDate: '1995', parents: ['dad', 'mom'], spouses: ['cuz2'] }),
    person('cuz1', { gender: M, birthDate: '1988', parents: ['unc1', 'aunt1w'], spouses: ['cuz1W'] }),
    person('cuz1W', { gender: F, spouses: ['cuz1'] }),
    person('cuz5', { gender: M, birthDate: '1994', parents: ['unc2', 'aunt2w'], spouses: ['cuz5W'] }),
    person('cuz5W', { gender: F, spouses: ['cuz5'] }),
    person('cuz6', { gender: F, birthDate: '1989', parents: ['unc1', 'aunt1w'], spouses: ['cuz6H'] }),
    person('cuz6H', { gender: M, spouses: ['cuz6'] }),
    person('cuz2', { gender: F, birthDate: '1992', parents: ['unc1', 'aunt1w'], spouses: ['ybro'] }),
    person('cuz4', { gender: F, birthDate: '1991', parents: ['unc2', 'aunt2w'], spouses: ['cuz4H'] }),
    person('cuz4H', { gender: M, spouses: ['cuz4'] }),
    person('cuzkid', { gender: M, birthDate: '2015', parents: ['cuz1'] }),
    person('fcuz', { gender: F, birthDate: '1987', parents: ['aunt', 'auntH'] }),
    person('mcuz', { gender: F, birthDate: '1988', parents: ['msis', 'msisH'], spouses: ['mcuzH'] }),
    person('mcuzH', { gender: M, spouses: ['mcuz'] }),
    person('mcuz4', { gender: F, birthDate: '1995', parents: ['msis', 'msisH'], spouses: ['mcuz4H'] }),
    person('mcuz4H', { gender: M, spouses: ['mcuz4'] }),
    person('mcuz2', { gender: M, birthDate: '1993', parents: ['mbro', 'mbroW'], spouses: ['mcuz2W'] }),
    person('mcuz2W', { gender: F, spouses: ['mcuz2'] }),
    person('mcuz3', { gender: M, birthDate: '1986', parents: ['mbro', 'mbroW'], spouses: ['mcuz3W'] }),
    person('mcuz3W', { gender: F, spouses: ['mcuz3'] }),
    person('wf', { gender: M, spouses: ['wm'] }),
    person('wm', { gender: F, spouses: ['wf'] }),
    person('wife', { gender: F, birthDate: '1991', parents: ['wf', 'wm'], spouses: ['me'] }),
    person('wb', { gender: M, birthDate: '1988', parents: ['wf', 'wm'] }),
    person('son', { gender: M, birthDate: '2018', parents: ['me', 'wife'], spouses: ['sonW'] }),
    person('dau', { gender: F, birthDate: '2020', parents: ['me', 'wife'], spouses: ['dauH'] }),
    person('dauH', { gender: M, spouses: ['dau'] }),
    person('sonWF', { gender: M }),
    person('sonW', { gender: F, parents: ['sonWF'], spouses: ['son'] }),
    person('gson', { gender: M, parents: ['son', 'sonW'] }),
    person('stranger', { gender: M }),
  ]
}

const toMap = (list: Person[]): People => new Map(list.map(p => [p.id, p]))
const fam = toMap(family())
const zh = (id: string, from = 'me', people = fam) => {
  const k = kinTerm(people, from, id)
  return typeof k === 'object' && k ? k.zh : k
}
const kin = (id: string, from = 'me', people = fam) => kinTerm(people, from, id)

describe('kinTerm', () => {
  it('handles self, strangers and missing people', () => {
    expect(kin('me', 'me')).toBe('self')
    expect(kin('stranger')).toBeNull()
    expect(kin('nobody')).toBeNull()
    expect(kin('me', 'nobody')).toBeNull()
  })

  it('names parents, grandparents and ancestors', () => {
    expect(zh('dad')).toBe('爸爸')
    expect(zh('mom')).toBe('媽媽')
    expect(zh('gf')).toBe('爺爺')
    expect(zh('gm')).toBe('奶奶')
    expect(zh('mgf')).toBe('外公')
    expect(zh('mgm')).toBe('外婆')
    expect(zh('ggf')).toBe('曾祖父')
    expect(zh('ggm')).toBe('曾祖母')
    expect(kin('gf')).toEqual({ zh: '爺爺', en: 'grandfather', gloss: "father's father" })
    expect(kin('dad')).toEqual({ zh: '爸爸', en: 'father', gloss: '' })
  })

  it('tells 伯父 from 叔叔 by birth date, and 伯母 from 嬸嬸', () => {
    expect(kin('unc1')).toEqual({ zh: '伯父', en: 'uncle', gloss: "father's older brother" })
    expect(kin('unc2')).toEqual({ zh: '叔叔', en: 'uncle', gloss: "father's younger brother" })
    expect(kin('aunt1w')).toEqual({ zh: '伯母', en: 'aunt', gloss: "father's older brother's wife" })
    expect(zh('aunt2w')).toBe('嬸嬸')
  })

  it('names the other aunts and uncles', () => {
    expect(zh('aunt')).toBe('姑姑')
    expect(zh('auntH')).toBe('姑丈')
    expect(zh('mbro')).toBe('舅舅')
    expect(zh('mbroW')).toBe('舅媽')
    expect(zh('msis')).toBe('阿姨')
    expect(zh('msisH')).toBe('姨丈')
  })

  it('uses the hand-set order of siblings when there are no dates', () => {
    const people = toMap([
      person('g', { gender: M }),
      person('f', { gender: M, parents: ['g'], order: 5 }),
      person('k1', { gender: M, parents: ['g'], order: 1 }),
      person('k2', { gender: M, parents: ['g'], order: 9 }),
      person('k3', { gender: M, parents: ['g'], order: 5 }),
      person('gx', { gender: '', parents: ['g'], order: 1 }),
      person('gxs', { gender: M, parents: ['gx'] }),
      person('kid', { parents: ['f'] }),
    ])
    expect(zh('k1', 'kid', people)).toBe('伯父')
    expect(zh('k2', 'kid', people)).toBe('叔叔')
    // Same order: nothing decides, so both are offered
    expect(kin('k3', 'kid', people)).toEqual({ zh: '伯父或叔叔', en: 'uncle', gloss: "father's brother" })
    // Unknown gender: a brother (older, so 伯父) or a sister
    expect(zh('gx', 'kid', people)).toBe('伯父或姑姑')
    // Unknown gender of the cousin's parent leaves too many choices, so the term is composed
    expect(kin('gxs', 'kid', people)).toEqual({
      zh: '爸爸的哥哥或姊姊的兒子',
      en: "father's brother or sister's son",
      gloss: "father's older sibling's son",
    })
    // ...and with the age unknown too, a plain 'sibling'
    const same = toMap([...people.values()].map(p => (p.id === 'gx' ? { ...p, order: 5 } : p)))
    expect(zh('gxs', 'kid', same)).toBe('爸爸的兄弟姊妹的兒子')
  })

  it('tells 堂 cousins from 表 cousins, older from younger', () => {
    expect(kin('cuz1')).toEqual({ zh: '堂哥', en: 'older cousin', gloss: "father's older brother's son" })
    expect(zh('cuz4')).toBe('堂妹')
    expect(zh('fcuz')).toBe('表姊')
    expect(kin('mcuz')).toEqual({ zh: '表姊', en: 'older cousin', gloss: "mother's younger sister's daughter" })
    expect(zh('mcuz2')).toBe('表弟')
  })

  it('names cousins\' children and parents\' cousins', () => {
    expect(zh('cuzkid')).toBe('堂姪')
    expect(kin('gbs')).toEqual({ zh: '堂伯', en: "father's cousin", gloss: "father's father's older brother's son" })
    expect(zh('gbro')).toBe('伯公')
  })

  it('names siblings and their spouses, including half siblings', () => {
    expect(kin('bro')).toEqual({ zh: '哥哥', en: 'older brother', gloss: '' })
    expect(zh('sis')).toBe('妹妹')
    expect(zh('half')).toBe('哥哥')
    expect(zh('broW')).toBe('嫂嫂')
    expect(zh('sisH')).toBe('妹夫')
    expect(zh('me', 'bro')).toBe('弟弟')
  })

  it('takes the shortest path when relatives marry', () => {
    // cuz2 is my cousin, but also my younger brother's wife
    expect(kin('cuz2')).toEqual({ zh: '弟媳', en: 'sister-in-law', gloss: "younger brother's wife" })
    expect(zh('cuz2', 'cuz1')).toBe('妹妹')
  })

  it('names a spouse\'s family', () => {
    expect(zh('wife')).toBe('妻子')
    expect(zh('dad', 'wife')).toBe('公公')
    expect(zh('mom', 'wife')).toBe('婆婆')
    expect(zh('wf')).toBe('岳父')
    expect(zh('bro', 'wife')).toBe('大伯')
    expect(zh('ybro', 'wife')).toBe('小叔')
    expect(zh('sis', 'wife')).toBe('小姑')
    expect(zh('wb')).toBe('大舅子')
  })

  it('does not call a father\'s earlier partner a stepmother without dates', () => {
    expect(kin('mom2')).toEqual({ zh: '爸爸的妻子', en: "father's wife", gloss: '' })
  })

  it('names the spouse of a parent by the dates', () => {
    const mar = (married: string, divorced = '') => ({ married, divorced, status: '' as const })
    const make = (dadMom: ReturnType<typeof mar>, dadOther: ReturnType<typeof mar>, extra: Record<string, Partial<Person>> = {}) =>
      toMap([
        person('dad', { gender: M, spouses: ['mom', 'other'], marriages: { mom: dadMom, other: dadOther } }),
        person('mom', { gender: F, spouses: ['dad'], marriages: { dad: dadMom }, ...extra.mom }),
        person('other', { gender: F, spouses: ['dad'], marriages: { dad: dadOther }, ...extra.other }),
        person('me', { gender: M, birthDate: '1990', parents: ['dad', 'mom'] }),
        person('girl', { gender: F, birthDate: '1991', parents: ['dad', 'mom'] }),
        person('okid', { gender: M, birthDate: '1980', parents: ['other'] }),
      ])
    // Remarried after my mother died
    const widowed = make(mar('1988'), mar('1998'), { mom: { deathDate: '1995' } })
    expect(kin('other', 'me', widowed)).toEqual({ zh: '繼母', en: 'stepmother', gloss: "father's wife" })
    expect(zh('me', 'other', widowed)).toBe('繼子')
    expect(zh('girl', 'other', widowed)).toBe('繼女')
    expect(zh('okid', 'me', widowed)).toBe('繼母的兒子')
    // Divorced before I was born
    const divorced = make(mar('1988'), mar('1980', '1985'))
    expect(zh('other', 'me', divorced)).toBe('爸爸的前妻')
    expect(kin('other', 'me', divorced)).toMatchObject({ en: "father's former wife" })
    expect(zh('me', 'other', divorced)).toBe('前夫的兒子')
    expect(zh('girl', 'other', divorced)).toBe('前夫的女兒')
    expect(zh('okid', 'me', divorced)).toBe('爸爸的前妻的兒子')
    // Overlapping or undated: no guess
    const overlap = make(mar('1988'), mar('1989'))
    expect(zh('other', 'me', overlap)).toBe('爸爸的妻子')
    expect(zh('me', 'other', overlap)).toBe('丈夫的兒子')
    // (the composition falls through to the wife's son, whom my father did marry after he was born)
    expect(zh('okid', 'me', overlap)).toBe('爸爸的繼子')
    const undated = make(mar(''), mar(''))
    expect(zh('other', 'me', undated)).toBe('爸爸的妻子')
  })

  it('names the husband of a parent, and former spouses from either side', () => {
    const mar = (married: string, divorced = '') => ({ married, divorced, status: '' as const })
    const people = toMap([
      person('mom', { gender: F, spouses: ['dad', 'step', 'ex'], marriages: { dad: mar('1980', '1985'), step: mar('1998'), ex: mar('1975', '1979') } }),
      person('dad', { gender: M, spouses: ['mom'], marriages: { mom: mar('1980', '1985') } }),
      person('step', { gender: M, spouses: ['mom'], marriages: { mom: mar('1998') } }),
      person('ex', { gender: M, spouses: ['mom'], marriages: { mom: mar('1975', '1979') } }),
      person('me', { gender: F, birthDate: '1983', parents: ['dad', 'mom'] }),
    ])
    expect(zh('step', 'me', people)).toBe('繼父')
    expect(zh('me', 'step', people)).toBe('繼女')
    // Divorced before I was born, and before mom met my father
    expect(kin('ex', 'me', people)).toMatchObject({ zh: '媽媽的前夫', en: "mother's former husband" })
    expect(zh('me', 'ex', people)).toBe('前妻的女兒')
    // A man's former wife's son
    const ex2 = toMap([
      person('x', { gender: M, spouses: ['w'], marriages: { w: mar('1975', '1980') } }),
      person('w', { gender: F, spouses: ['x'], marriages: { x: mar('1975', '1980') } }),
      person('k', { gender: M, birthDate: '1990', parents: ['w'] }),
      person('kd', { gender: F, birthDate: '1991', parents: ['w'] }),
    ])
    expect(kin('k', 'x', ex2)).toMatchObject({ zh: '前妻的兒子', en: "former wife's son" })
    expect(zh('kd', 'x', ex2)).toBe('前妻的女兒')
    expect(zh('x', 'k', ex2)).toBe('媽媽的前夫')
  })

  it('tells 堂 from 表 by whether the siblings share a father\'s line', () => {
    const people = toMap([
      person('gx', { gender: M }), person('gy', { gender: M }), person('gm', { gender: F }),
      person('gf', { gender: M, parents: ['gx', 'gm'] }),
      // Father's brother by the same father, and by the same mother only
      person('dad', { gender: M, birthDate: '1960', parents: ['gf', 'gm'] }),
      person('half', { gender: M, birthDate: '1962', parents: ['gy', 'gm'] }),
      person('full', { gender: M, birthDate: '1963', parents: ['gf', 'gm'] }),
      person('halfs', { gender: M, birthDate: '1985', parents: ['half'] }),
      person('halfs2', { gender: M, birthDate: '1995', parents: ['half'] }),
      person('fulls', { gender: M, birthDate: '1985', parents: ['full'] }),
      person('me', { gender: M, birthDate: '1990', parents: ['dad'] }),
      // Father's father's maternal half-brother (gf and ggb share only a mother) and his son
      person('ggm', { gender: F }),
      person('gf2', { gender: M, birthDate: '1930', parents: ['gx', 'ggm'] }),
      person('ggb', { gender: M, birthDate: '1932', parents: ['gy', 'ggm'] }),
      person('ggbs1', { gender: M, birthDate: '1955', parents: ['ggb'] }),
      person('ggbs2', { gender: M, birthDate: '1965', parents: ['ggb'] }),
      person('dad2', { gender: M, birthDate: '1960', parents: ['gf2'] }),
      person('me2', { gender: M, birthDate: '1990', parents: ['dad2'] }),
    ])
    expect(zh('halfs', 'me', people)).toBe('表哥')
    expect(zh('halfs2', 'me', people)).toBe('表弟')
    expect(zh('fulls', 'me', people)).toBe('堂哥')
    expect(zh('half', 'me', people)).toBe('叔叔')
    expect(zh('ggbs1', 'me2', people)).toBe('表伯')
    expect(zh('ggbs2', 'me2', people)).toBe('表叔')
    // Only the grandmother recorded: no sign of different fathers, so still 堂
    const sparse = toMap([
      person('gm', { gender: F }),
      person('dad', { gender: M, birthDate: '1960', parents: ['gm'] }),
      person('unc', { gender: M, birthDate: '1962', parents: ['gm'] }),
      person('cuz', { gender: M, birthDate: '1985', parents: ['unc'] }),
      person('me', { gender: M, birthDate: '1990', parents: ['dad'] }),
    ])
    expect(zh('cuz', 'me', sparse)).toBe('堂哥')
  })

  it('names cousins\' spouses', () => {
    expect(kin('cuz1W')).toEqual({ zh: '堂嫂', en: "cousin's wife", gloss: "father's older brother's son's wife" })
    expect(zh('cuz5W')).toBe('堂弟媳')
    expect(kin('cuz6H')).toMatchObject({ zh: '堂姊夫', en: "cousin's husband" })
    expect(zh('cuz4H')).toBe('堂妹夫')
    expect(zh('mcuz3W')).toBe('表嫂')
    expect(zh('mcuz2W')).toBe('表弟媳')
    expect(zh('mcuzH')).toBe('表姊夫')
    expect(zh('mcuz4H')).toBe('表妹夫')
  })

  it('names unknown-gender parents, children and siblings', () => {
    const people = toMap([
      person('p', { parents: [] }),
      person('older', { gender: '', birthDate: '1980', parents: ['p'] }),
      person('nodate', { gender: '', parents: ['p'] }),
      person('me', { gender: M, birthDate: '1990', parents: ['p'] }),
      person('kid', { gender: '', parents: ['me'] }),
    ])
    expect(kin('p', 'me', people)).toEqual({ zh: '爸爸或媽媽', en: 'father or mother', gloss: '' })
    expect(kin('kid', 'me', people)).toEqual({ zh: '兒子或女兒', en: 'son or daughter', gloss: '' })
    expect(kin('older', 'me', people)).toEqual({ zh: '哥哥或姊姊', en: 'older brother or sister', gloss: '' })
    // No age either: four candidates, so just 'sibling'
    expect(kin('nodate', 'me', people)).toEqual({ zh: '兄弟姊妹', en: 'sibling', gloss: '' })
    expect(zh('me', 'p', people)).toBe('兒子')
  })

  it('names brothers\' grandchildren and great-grandchildren', () => {
    const lineage = (root: string, depth: number): Person[] => {
      const out: Person[] = []
      let layer = [root]
      for (let d = 0; d < depth; d++) {
        layer = layer.flatMap(id => ['S', 'D'].map(c => {
          out.push(person(id + c, { gender: c === 'S' ? M : F, parents: [id] }))
          return id + c
        }))
      }
      return out
    }
    const people = toMap([
      person('dad', { gender: M }),
      person('bro', { gender: M, birthDate: '1985', parents: ['dad'] }),
      person('me', { gender: M, birthDate: '1990', parents: ['dad'] }),
      ...lineage('bro', 2), ...lineage('me', 3),
    ])
    const want: Record<string, string> = {
      broSS: '姪孫', broSD: '姪孫女', broDS: '外姪孫', broDD: '外姪孫女',
      meSSS: '曾孫', meSSD: '曾孫女', meSDS: '曾外孫', meSDD: '曾外孫女',
      meDSS: '外曾孫', meDSD: '外曾孫女', meDDS: '重外孫', meDDD: '重外孫女',
    }
    for (const [id, term] of Object.entries(want)) expect(zh(id, 'me', people)).toBe(term)
    expect(kin('meSSS', 'me', people)).toMatchObject({ en: 'great-grandson' })
  })

  it('splits a husband\'s brother\'s wife by age', () => {
    const people = toMap([
      person('h', { gender: M, birthDate: '1980', parents: ['f'], spouses: ['me'] }),
      person('f', { gender: M }),
      person('me', { gender: F, spouses: ['h'] }),
      person('ob', { gender: M, birthDate: '1975', parents: ['f'], spouses: ['obw'] }),
      person('obw', { gender: F, spouses: ['ob'] }),
      person('yb', { gender: M, birthDate: '1985', parents: ['f'], spouses: ['ybw'] }),
      person('ybw', { gender: F, spouses: ['yb'] }),
    ])
    expect(kin('obw', 'me', people)).toMatchObject({ zh: '大嫂', en: 'sister-in-law' })
    expect(zh('ybw', 'me', people)).toBe('小嬸')
  })

  it('names descendants and their in-laws', () => {
    expect(zh('son')).toBe('兒子')
    expect(zh('dau')).toBe('女兒')
    expect(zh('gson')).toBe('孫子')
    expect(zh('sonW')).toBe('媳婦')
    expect(zh('dauH')).toBe('女婿')
    expect(zh('sonWF')).toBe('親家公')
  })

  it('composes terms for relatives past the table', () => {
    // father's father's older brother's son's son
    expect(kin('gbss')).toEqual({
      zh: '堂伯的兒子',
      en: "father's cousin's son",
      gloss: "father's father's older brother's son's son",
    })
  })

  it('looks at the birth date, not the order of entry, for cousins', () => {
    const people = toMap(family().map(p => (p.id === 'cuz1' ? { ...p, birthDate: '' } : p)))
    expect(kin('cuz1', 'me', people)).toEqual({ zh: '堂哥或堂弟', en: 'cousin', gloss: "father's older brother's son" })
  })

  it('shows both choices when a sibling\'s age is unknown', () => {
    const people = toMap(family().map(p => (p.id === 'half' ? { ...p, birthDate: '' } : p)))
    expect(zh('half', 'me', people)).toBe('哥哥或弟弟')
    expect(kin('half', 'me', people)).toEqual({ zh: '哥哥或弟弟', en: 'brother', gloss: '' })
  })

  it('does not guess a term when one reading has none', () => {
    // A son's spouse of unknown gender: 媳婦 only if a wife, and the table has no word for a son's husband.
    const people = toMap(family().map(p => (p.id === 'sonW' ? { ...p, gender: '' as const } : p)))
    expect(zh('sonW', 'me', people)).toBe('兒子的配偶')
  })

  it('does not reuse results for a changed family', () => {
    expect(zh('unc1')).toBe('伯父')
    const changed = toMap(family().map(p => (p.id === 'unc1' ? { ...p, birthDate: '1960' } : p)))
    expect(zh('unc1', 'me', changed)).toBe('叔叔')
    expect(zh('unc1')).toBe('伯父')
  })
})
