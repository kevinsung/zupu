// @vitest-environment jsdom
// jsdom because i18n reads localStorage; the default language setting shows both languages.
import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError, UserError, errorText } from '../src/errors'
import { pair, pairName, prefixed } from '../src/i18n'

const failed = pair('saveFailed')

describe('prefixed', () => {
  it('puts each language on its own side', () => {
    expect(prefixed(['出生日期', 'Birth date'], ['請填寫', 'fill it in'])).toEqual(['出生日期：請填寫', 'Birth date: fill it in'])
  })
})

describe('pairName', () => {
  it('fills in the name on both sides', () => {
    expect(pairName('hasOtherParent', 'Al')).toEqual(['Al已有其他父母', 'Al already has another parent'])
  })
})

describe('errorText', () => {
  it('shows a UserError as is, never as a failure', () => {
    const e = new UserError(pair('pickPerson'))
    expect(errorText(e)).toBe('請先選擇一個人 / Choose a person first')
    expect(errorText(e, failed)).toBe('請先選擇一個人 / Choose a person first')
    expect(e.message).toBe(errorText(e))
  })

  it('words a network failure, without the browser\'s text', () => {
    const e = new NetworkError('Failed to fetch')
    expect(errorText(e)).toBe("無法連線，請檢查網路後再試 / Couldn't connect. Check your connection and try again.")
    expect(errorText(e, failed)).toBe("儲存失敗：無法連線，請檢查網路後再試 / Save failed: Couldn't connect. Check your connection and try again.")
  })

  it('words a 409 as the person being gone', () => {
    expect(errorText(new ApiError(409, 'conflict'), failed)).toBe('儲存失敗：此人已被刪除，請重新整理 / Save failed: This person no longer exists; please reload')
  })

  it('words a 400 as a refusal, with the Worker\'s detail', () => {
    expect(errorText(new ApiError(400, 'invalid order'))).toBe('伺服器拒絕了這項修改（invalid order） / The server refused this change (invalid order)')
    expect(errorText(new ApiError(400, 'invalid order'), failed)).toBe('儲存失敗：伺服器拒絕了這項修改（invalid order） / Save failed: The server refused this change (invalid order)')
  })

  it('words any other status as a server error, with the detail', () => {
    expect(errorText(new ApiError(500, 'boom'), failed)).toBe('儲存失敗：伺服器發生錯誤（boom） / Save failed: Server error (boom)')
    expect(errorText(new ApiError(503, ''))).toBe('伺服器發生錯誤 / Server error')
  })

  it('keeps the message of anything else (a bug), behind the prefix when given', () => {
    expect(errorText(new Error('oops'))).toBe('oops')
    expect(errorText(new Error('oops'), pair('loadFailed'))).toBe("無法載入資料：oops / Couldn't load data: oops")
  })
})
