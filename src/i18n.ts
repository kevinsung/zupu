// Labels as [中文, English] pairs. Each relative picks 中英 (both, the default), 中文 or English.
const LANG_KEY = 'ft-lang'

export type Lang = 'both' | 'zh' | 'en'

export function getLang(): Lang {
  let v: string | null = null
  try { v = localStorage.getItem(LANG_KEY) } catch {}
  return v === 'zh' || v === 'en' ? v : 'both'
}

/** Stores the choice; the caller reloads, since labels are built once at startup. */
export function setLang(lang: Lang) {
  if (lang === 'both') localStorage.removeItem(LANG_KEY)
  else localStorage.setItem(LANG_KEY, lang)
}

export const lang = getLang()
document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant'

const pairs = {
  title: ['族譜', 'Family Tree'],
  password: ['密碼', 'Password'],
  signIn: ['登入', 'Sign in'],
  wrongPassword: ['密碼錯誤', 'Wrong password'],
  tooManyAttempts: ['嘗試次數過多，請稍後再試', 'Too many attempts, try again later'],
  signOut: ['登出', 'Sign out'],
  loading: ['載入中…', 'Loading…'],
  search: ['搜尋姓名', 'Search names'],
  noResults: ['找不到', 'No matches'],
  resultOne: ['1 筆結果', '1 result'],
  resultCount: ['{n} 筆結果', '{n} results'],
  history: ['修改紀錄', 'History'],
  personHistory: ['此人的修改紀錄', 'History of this person'],
  editorLabel: ['編輯者', 'Editor'],
  editorPrompt: ['請輸入您的名字（會記錄在修改紀錄中）', 'Your name (shown in the change history)'],
  settings: ['設定', 'Settings'],
  language: ['語言', 'Language'],

  nameZh: ['中文姓名', 'Chinese name'],
  nameEn: ['英文姓名', 'English name'],
  otherNames: ['別名、小名', 'Other names, nicknames'],
  otherNamesHint: ['用逗號分隔', 'Separate with commas'],
  gender: ['性別', 'Gender'],
  male: ['男', 'M'],
  female: ['女', 'F'],
  unknownGender: ['不詳', 'Unknown'],
  // Spoken with a name (tree cards, person cards), where 'M' and 'F' would be unclear.
  maleWord: ['男', 'male'],
  femaleWord: ['女', 'female'],
  birthDate: ['出生日期', 'Birth date'],
  deathDate: ['逝世日期', 'Death date'],
  dateHint: ['YYYY、YYYY-MM 或 YYYY-MM-DD', 'YYYY, YYYY-MM or YYYY-MM-DD'],
  notes: ['備註', 'Notes'],
  contact: ['聯絡方式', 'Contact'],
  email: ['電子郵件', 'Email'],
  phone: ['電話', 'Phone'],
  address: ['地址', 'Mailing address'],
  line: ['LINE', 'LINE'],
  signal: ['Signal', 'Signal'],
  phoneHint: ['請加國碼', 'Include the country code'],
  lineHint: ['LINE ID（設定 → 個人檔案）', 'LINE ID (Settings → Profile)'],
  signalHint: ['用戶名稱（設定 → 個人檔案）', 'Username (Settings → Profile)'],
  badEmail: ['電子郵件格式不正確', 'Invalid email address'],
  badPhone: ['電話號碼不正確：請加國碼，不要加分機', 'Invalid phone number: include the country code, no extension'],
  badDate: ['日期格式應為 YYYY、YYYY-MM 或 YYYY-MM-DD', 'Dates must be YYYY, YYYY-MM or YYYY-MM-DD'],
  call: ['撥打', 'Call'],
  text: ['簡訊', 'Text'],
  copy: ['複製', 'Copy'],

  parents: ['父母', 'Parents'],
  spouses: ['配偶', 'Spouses'],
  marriage: ['婚姻', 'Marriage'],
  married: ['結婚', 'Married'],
  divorced: ['離婚', 'Divorced'],
  marriedDate: ['結婚日期', 'Marriage date'],
  divorcedDate: ['離婚日期', 'Divorce date'],
  addMarriage: ['新增結婚日期', 'Add marriage dates'],
  editMarriage: ['編輯婚姻', 'Edit marriage'],
  children: ['子女', 'Children'],
  siblings: ['兄弟姊妹', 'Siblings'],
  self: ['本人', 'this person'],
  fullSiblings: ['同父同母', 'Full siblings'],
  halfSiblingsPaternal: ['同父異母', 'Half siblings, same father'],
  halfSiblingsMaternal: ['同母異父', 'Half siblings, same mother'],
  halfPaternal: ['同父異母', 'Half · same father'],
  halfMaternal: ['同母異父', 'Half · same mother'],
  halfVia: ['同父或同母', 'Half · via'],
  onlyParent: ['只有', 'Only'],
  unknownOtherParent: ['另一位父母不詳', 'other parent unknown'],
  none: ['（無）', '(none)'],

  edit: ['編輯', 'Edit'],
  add: ['新增', 'Add'],
  addParent: ['新增父母', 'Add parent'],
  addSpouse: ['新增配偶', 'Add spouse'],
  addChild: ['新增子女', 'Add child'],
  addSibling: ['新增兄弟姊妹', 'Add sibling'],
  addSpouseOrChild: ['新增配偶或子女', 'Add a spouse or child'],
  addFirst: ['新增第一個人', 'Add the first person'],
  siblingNeedsParent: ['請先新增父母', 'Add a parent first'],
  parentsFull: ['已有兩位父母', 'Already has two parents'],
  linkExisting: ['連結現有的人', 'Link an existing person'],
  linkAs: ['關係', 'Relationship'],
  pickPerson: ['請先選擇一個人', 'Choose a person first'],
  asParent: ['是此人的父母', 'is a parent of this person'],
  asSpouse: ['是此人的配偶', 'is a spouse of this person'],
  asChild: ['是此人的子女', 'is a child of this person'],
  confirmUnlink: ['確定要移除這個關係嗎？', 'Remove this relationship?'],
  otherParent: ['另一位父母', 'Other parent'],
  otherParentNone: ['不詳或無', 'Unknown or none'],
  alsoSpouseOf: ['同時為此人的配偶：', 'Also a spouse of:'],
  delete: ['刪除', 'Delete'],
  confirmDelete: ['確定要刪除此人嗎？此操作會記錄在修改紀錄，可以還原。', 'Delete this person? This is logged in the history and can be reverted.'],
  copied: ['已複製', 'Copied'],
  close: ['關閉', 'Close'],
  save: ['儲存', 'Save'],
  cancel: ['取消', 'Cancel'],
  saveFailed: ['儲存失敗', 'Save failed'],

  historyEmpty: ['尚無修改', 'No changes yet'],
  historyDetails: ['詳細', 'Details'],
  revert: ['還原', 'Revert'],
  confirmRevert: ['將這些人恢復到此修改之前的狀態？之後對他們的修改也會被覆蓋。', 'Restore these people to how they were before this change? Later edits to them will be overwritten too.'],
  created: ['新增', 'Created'],
  deleted: ['刪除', 'Deleted'],
  loadFailed: ['無法載入資料', 'Could not load data'],

  more: ['更多', 'More'],
  menu: ['選單', 'Menu'],
  share: ['分享', 'Share'],
  familyLines: ['家族', 'Family lines'],
  recent: ['最近查看', 'Recently viewed'],
  spousesChildren: ['配偶與子女', 'Spouses & children'],
  removeRelationship: ['移除關係', 'Remove a relationship'],
  noRelationships: ['沒有可移除的關係', 'No relationships to remove'],
  remove: ['移除', 'Remove'],
  showInTree: ['在族譜中查看', 'Show in tree'],
  viewPerson: ['查看', 'View'],
  center: ['回到此人', 'Back to selected person'],
  fit: ['顯示整個族譜', 'Fit the whole tree'],
  zoomIn: ['放大', 'Zoom in'],
  zoomOut: ['縮小', 'Zoom out'],
  treeControls: ['樹狀圖控制', 'Tree controls'],
  treeKeysHint: ['用方向鍵在家人之間移動，按 Enter 選取', 'Arrow keys move between people; Enter selects'],
  change: ['更改', 'Change'],
  appearance: ['外觀', 'Appearance'],
  themeAuto: ['跟隨系統', 'Auto'],
  themeLight: ['淺色', 'Light'],
  themeDark: ['深色', 'Dark'],
  tabTree: ['族譜', 'Tree'],
  tabPerson: ['人物', 'Person'],
  tabSearch: ['搜尋', 'Search'],
  tabMenu: ['選單', 'Menu'],
  age: ['{n}歲', 'age {n}'],
  ageApprox: ['約{n}歲', 'about {n}'],
  agedAtDeath: ['享年{n}', 'aged {n}'],
  agedAtDeathApprox: ['享年約{n}', 'aged about {n}'],
} as const satisfies Record<string, readonly [string, string]>

export type Key = keyof typeof pairs

function join(zh: string, en: string): string {
  if (lang === 'zh') return zh
  if (lang === 'en') return en
  return zh === en ? zh : `${zh} / ${en}`
}

/** Plain-text labels in the chosen language(s), for attributes, titles, messages and inline text. */
export const t = Object.fromEntries(
  Object.entries(pairs).map(([k, [zh, en]]) => [k, join(zh, en)]),
) as Record<Key, string>

/** A label with a number filled in, e.g. tn('age', 33) → "33歲 / age 33". */
export function tn(key: Key, n: number): string {
  const [zh, en] = pairs[key]
  return join(zh.replace('{n}', String(n)), en.replace('{n}', String(n)))
}

/**
 * A label as a node for prominent UI text. With both languages, the English follows the
 * Chinese in a smaller, lighter span (stacked where CSS says so, e.g. in the tab bar).
 */
export function L(key: Key): Node {
  const [zh, en] = pairs[key]
  if (lang !== 'both' || zh === en) return document.createTextNode(join(zh, en))
  const frag = document.createDocumentFragment()
  const zhEl = document.createElement('span')
  zhEl.className = 'zh'
  zhEl.lang = 'zh-Hant'
  zhEl.textContent = zh
  const enEl = document.createElement('span')
  enEl.className = 'en'
  enEl.lang = 'en'
  enEl.textContent = en
  frag.append(zhEl, ' ', enEl)
  return frag
}

/** BCP 47 locale for dates and times; the browser's own when showing both languages. */
export const locale: string | undefined = lang === 'zh' ? 'zh-TW' : lang === 'en' ? 'en' : undefined
