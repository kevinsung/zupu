// Simplified Chinese for the UI only. The app's Chinese is written in Taiwanese Traditional; in 简体
// mode the UI text is converted, never stored or user data (names, notes, history headlines).
// Pure, no DOM, so tests and scripts can use it.
import { HANS_MAP } from './hans-map'

/**
 * Taiwan-only words (Traditional to Traditional), replaced before characters are mapped. Conservative:
 * a substring replacement must be right inside any longer word it can occur in.
 * opencc's own phrase dictionary (twp) is deliberately not used: it turns 資料 into 数据.
 */
export const VOCAB: [from: string, to: string][] = [
  ['姊', '姐'],
  ['設定', '設置'],
  ['搜尋', '搜索'],
  ['原始碼', '源代碼'],
  ['儲存', '保存'],
  ['載入資料', '加載數據'],
  ['載入', '加載'],
  ['姪', '侄'],
  ['紀錄', '記錄'],
  ['網路', '網絡'],
  ['連線', '連接'],
  ['個人檔案', '個人資料'],
  ['傳簡訊', '發短信'],
  ['使用者名稱', '用戶名'],
  ['伺服器', '服務器'],
  ['選單', '菜單'],
  ['主畫面', '主屏幕'],
  ['聯絡', '聯繫'],
  ['國碼', '國家區號'],
  ['登入', '登錄'],
  ['登出', '退出登錄'],
  ['檢視', '視圖'],
  ['復原', '撤銷'],
  ['重新整理', '刷新'],
]

/** Kinship table terms (exact match) that a mainland speaker says differently. Matched per term, so 孫媳婦 is untouched. */
export const HANS_KIN: Record<string, string> = {
  '媳婦': '兒媳婦',
  '姑丈': '姑父',
  '姨丈': '姨父',
  '姑丈公': '姑祖父',
  '姨丈公': '姨祖父',
  '小嬸': '弟妹',
}

export function vocab(s: string): string {
  return VOCAB.reduce((acc, [from, to]) => acc.replaceAll(from, to), s)
}

/** Character-by-character Traditional to Simplified, using the generated map. */
export function toHans(s: string): string {
  let out = ''
  for (const c of s) out += HANS_MAP[c] ?? c
  return out
}

/** UI text: Taiwan-only words first, then characters. */
export const uiHans = (s: string): string => toHans(vocab(s))

/** A kinship table term in Simplified. */
export const hansKin = (term: string): string => uiHans(HANS_KIN[term] ?? term)

export type Script = 'Hant' | 'Hans'

/** The stored choice, else Hans if the browser's first Chinese language is mainland, Singapore or Malaysia Chinese. */
export function scriptFor(stored: string | null, languages: readonly string[]): Script {
  if (stored === 'Hant' || stored === 'Hans') return stored
  const zh = languages.map(l => l.toLowerCase()).find(l => l === 'zh' || l.startsWith('zh-'))
  return zh && /^zh-(cn|sg|my|hans)(-|$)/.test(zh) ? 'Hans' : 'Hant'
}
