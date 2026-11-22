import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as OpenCC from 'opencc-js'
import { HANS_KIN, scriptFor, uiHans, vocab } from '../src/hans'
import { type People, type Person, emptyFields } from '../src/model'
import { kinTerm, setZhTerm } from '../src/kinship'
import { hansKin } from '../src/hans'

const tw2s = OpenCC.Converter({ from: 'tw', to: 'cn' })
const han = /\p{Script=Han}/u

/** Every string literal in a source file that has Chinese in it (the Chinese sides of pairs, kinship terms). */
function literals(file: string): string[] {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  return [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map(m => m[1]!).filter(s => han.test(s))
}

describe('uiHans', () => {
  it('matches opencc on every UI string (else run `npm run gen:hans`)', () => {
    const strings = [...literals('src/i18n.ts'), ...literals('src/kinship.ts'), ...Object.values(HANS_KIN)]
    expect(strings.length).toBeGreaterThan(200)
    const wrong = strings.filter(s => uiHans(s) !== tw2s(vocab(s))).map(s => `${s}: ${uiHans(s)} vs ${tw2s(vocab(s))}`)
    expect(wrong, 'Stale src/hans-map.ts: run `npm run gen:hans`').toEqual([])
  })
  it('converts words and characters', () => {
    expect(uiHans('設定')).toBe('设置')
    expect(uiHans('待補資料')).toBe('待补资料')
    expect(uiHans('姊夫')).toBe('姐夫')
  })
})

describe('scriptFor', () => {
  it('prefers the stored value', () => {
    expect(scriptFor('Hant', ['zh-CN'])).toBe('Hant')
    expect(scriptFor('Hans', ['zh-TW'])).toBe('Hans')
  })
  it('uses the first Chinese browser language', () => {
    expect(scriptFor(null, ['en-US', 'zh-CN'])).toBe('Hans')
    expect(scriptFor(null, ['zh-sg'])).toBe('Hans')
    expect(scriptFor(null, ['zh-Hans-CN'])).toBe('Hans')
    expect(scriptFor(null, ['zh-TW', 'zh-CN'])).toBe('Hant')
    expect(scriptFor(null, ['zh'])).toBe('Hant')
    expect(scriptFor(null, [])).toBe('Hant')
    expect(scriptFor('junk', ['en'])).toBe('Hant')
  })
})

describe('kin terms in Simplified', () => {
  const person = (id: string, extra: Partial<Person> = {}): Person =>
    ({ ...emptyFields(), id, parents: [], spouses: [], marriages: {}, parentKinds: {}, order: 0, ...extra })
  const family = (): People => new Map([
    person('gf', { gender: 'M' }),
    person('dad', { gender: 'M', birthDate: '1958', parents: ['gf'] }),
    person('aunt', { gender: 'F', birthDate: '1950', parents: ['gf'], spouses: ['uncle'] }),
    person('uncle', { gender: 'M', spouses: ['aunt'] }),
    person('me', { gender: 'M', birthDate: '1990', parents: ['dad'], spouses: ['wife'] }),
    person('wife', { gender: 'F', spouses: ['me'] }),
    person('son', { gender: 'M', birthDate: '2018', parents: ['me', 'wife'], spouses: ['sonW'] }),
    person('sonW', { gender: 'F', spouses: ['son'] }),
    person('gson', { gender: 'M', birthDate: '2045', parents: ['son', 'sonW'], spouses: ['gsonW'] }),
    person('gsonW', { gender: 'F', spouses: ['gson'] }),
    person('ggson', { gender: 'M', birthDate: '2070', parents: ['gson', 'gsonW'], spouses: ['ggsonW'] }),
    person('ggsonW', { gender: 'F', spouses: ['ggson'] }),
  ].map(p => [p.id, p]))
  const zhOf = (people: People, id: string) => {
    const k = kinTerm(people, 'me', id)
    return typeof k === 'object' && k ? k.zh : k
  }

  it('converts each term once, with mainland wording', () => {
    setZhTerm(hansKin)
    try {
      expect(zhOf(family(), 'sonW')).toBe('儿媳妇')
      expect(zhOf(family(), 'gsonW')).toBe('孙媳妇')
      expect(zhOf(family(), 'uncle')).toBe('姑父')
      expect(zhOf(family(), 'ggsonW')).toContain('的')
    } finally {
      setZhTerm(s => s)
    }
    expect(zhOf(family(), 'sonW')).toBe('媳婦')
    expect(zhOf(family(), 'uncle')).toBe('姑丈')
  })
})
