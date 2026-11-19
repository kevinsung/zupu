import { describe, expect, it } from 'vitest'
import { PINYIN_SYLLABLE_COUNT, foldPinyin, isValidPinyin, parsePinyin } from '../src/pinyin'

const value = (s: string) => {
  const r = parsePinyin(s)
  if ('bad' in r) throw new Error(`rejected ${s}: ${r.bad}`)
  return r.value
}
const bad = (s: string) => {
  const r = parsePinyin(s)
  return 'bad' in r ? r.bad : null
}

describe('pinyin', () => {
  it('knows the standard syllables', () => {
    // The Hanyu Pinyin table, without interjections (m, n, ng, hm, hng, ê).
    expect(PINYIN_SYLLABLE_COUNT).toBe(413)
    for (const s of ['a', 'zhuang', 'shuang', 'lüe', 'nü', 'jiong', 'dia', 'rua', 'o', 'er', 'yo']) expect(value(s)).toBe(s[0].toUpperCase() + s.slice(1))
  })

  it('turns tone numbers into marks on the right vowel', () => {
    expect(value('Song4 Wen2hua2')).toBe('Sòng Wénhuá')
    expect(value('gui4 liu2 kou3 lüe4 er2')).toBe('Guì Liú Kǒu Lüè Ér')
    expect(value('chuang1ye4')).toBe('Chuāngyè')
    expect(value('ma5 ma0')).toBe('Ma Ma')
  })

  it('moves a mark typed on the wrong vowel and keeps marks typed right', () => {
    expect(value('sòng wénhúa')).toBe('Sòng Wénhuá')
    expect(value('Ōuyáng Xiū')).toBe('Ōuyáng Xiū')
  })

  it('accepts names without tones', () => {
    expect(value('song wenhua')).toBe('Song Wenhua')
  })

  it('reads v, u: and ü as ü, keeping lu and lü apart', () => {
    expect(value('lv3 nu:3 lü4')).toBe('Lǚ Nǚ Lǜ')
    expect(value('lu4')).toBe('Lù')
    expect(value('lue4')).toBe('Lüè')
    // After j, q, x and y, ü is written u.
    expect(value('xv2 jü4')).toBe('Xú Jù')
  })

  it('accepts erhua', () => {
    expect(value('huar4')).toBe('Huàr')
  })

  it('keeps word breaks as typed, capitalizing each word', () => {
    expect(value('song wen hua')).toBe('Song Wen Hua')
    expect(value('songwenhua')).toBe('Songwenhua')
    expect(value('  SONG   WENHUA ')).toBe('Song Wenhua')
    expect(value('Sòng Lín Wénhuá')).toBe('Sòng Lín Wénhuá')
  })

  it('takes the fewest syllables, adding an apostrophe only where the split is certain', () => {
    expect(value('xian')).toBe('Xian')
    expect(value('xi1an1')).toBe('Xī\'ān')
    expect(value('Xīān')).toBe('Xī\'ān')
    expect(value('jin1an1')).toBe('Jīn\'ān')
    expect(value('jinan')).toBe('Jinan')
  })

  it('keeps apostrophes and hyphens typed inside a word', () => {
    expect(value('Xi’an')).toBe('Xi\'an')
    expect(value('wen-hua')).toBe('Wen-hua')
  })

  it('accepts full-width input from Chinese keyboards', () => {
    expect(value('ＳＯＮＧ４')).toBe('Sòng')
  })

  it('treats blank as no pinyin', () => {
    expect(value('')).toBe('')
    expect(value('   ')).toBe('')
  })

  it('rejects words that are not pinyin, naming the first one', () => {
    expect(bad('xbio')).toBe('xbio')
    expect(bad('Song xbio3')).toBe('xbio3')
    // Wade-Giles and other romanizations.
    expect(bad('Hsu')).toBe('Hsu')
    expect(bad('Hsieh')).toBe('Hsieh')
    expect(bad('Tsai')).toBe('Tsai')
    expect(bad('sòóng')).toBe('sòóng') // two tones on one syllable
    expect(bad('song44')).toBe('song44')
    expect(bad('4song')).toBe('4song')
    expect(bad("'an")).toBe("'an")
    expect(bad('ǹg')).toBe('ǹg')
    // Every syllable here also happens to be pinyin, so it's accepted.
    expect(bad('Chang Wen-hua')).toBe(null)
  })

  it('validates only the tidied form', () => {
    expect(isValidPinyin('')).toBe(true)
    expect(isValidPinyin('Sòng Wénhuá')).toBe(true)
    expect(isValidPinyin('song wenhua')).toBe(false)
    expect(isValidPinyin('Song4')).toBe(false)
    expect(isValidPinyin('Xbio')).toBe(false)
  })

  it('folds to bare letters for search', () => {
    expect(foldPinyin('Lǚ Wén\'huá')).toBe('luwenhua')
    expect(foldPinyin('wen2 hua2')).toBe('wenhua')
    expect(foldPinyin('lv')).toBe('lu')
  })
})
