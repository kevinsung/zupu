// @vitest-environment jsdom
// jsdom because i18n reads localStorage; the default language setting shows both languages.
import { describe, expect, it } from 'vitest'
import { both, fill, list, noted, prefixed } from '../src/i18n'

describe('fill', () => {
  it('fills every placeholder on both sides', () => {
    expect(fill('removeName', { name: '甲' })).toEqual(['移除甲', 'Remove 甲'])
    expect(fill('age', { n: 33 })).toEqual(['33歲', 'age 33'])
  })
  it('leaves unknown placeholders alone', () => {
    expect(fill('removeName', {})).toEqual(['移除{name}', 'Remove {name}'])
  })
})

describe('prefixed', () => {
  it('repeats a string body on both sides', () => {
    expect(prefixed(['選單', 'Menu'], '甲')).toEqual(['選單：甲', 'Menu: 甲'])
  })
})

describe('noted', () => {
  it('uses full-width parentheses in Chinese and plain ones in English', () => {
    expect(noted(['只有甲', 'Only 甲'], ['同父異母', 'Half'])).toEqual(['只有甲（同父異母）', 'Only 甲 (Half)'])
    expect(noted('甲 & 乙', ['同父異母', 'Half'])).toEqual(['甲 & 乙（同父異母）', '甲 & 乙 (Half)'])
  })
  it('joins to one string', () => {
    expect(both(noted('甲', '乙'))).toBe('甲（乙） / 甲 (乙)')
  })
})

describe('list', () => {
  it('matches colon in both-language mode', () => {
    expect(list(['甲', '乙', '丙'])).toBe('甲, 乙, 丙')
  })
})
