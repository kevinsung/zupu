// Labels as [中文, English] pairs. Each relative picks 中英 (both, the default), 中文 or English.
import { h } from './dom'

const LANG_KEY = 'ft-lang'

export type Lang = 'both' | 'zh' | 'en'

export function getLang(): Lang {
  const v = localStorage.getItem(LANG_KEY)
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
  sourceCode: ['原始碼', 'Source code'],
  loading: ['載入中…', 'Loading…'],
  search: ['搜尋姓名', 'Search names'],
  noResults: ['找不到符合的結果', 'No matches'],
  resultOne: ['1 筆結果', '1 result'],
  resultCount: ['{n} 筆結果', '{n} results'],
  history: ['修改紀錄', 'History'],
  personHistory: ['此人的修改紀錄', 'History of this person'],
  editorLabel: ['編輯者', 'Editor'],
  editorPrompt: ['請輸入您的名字（會記錄在修改紀錄中）', 'Your name (shown in the change history)'],
  settings: ['設定', 'Settings'],
  stats: ['統計', 'Stats'],
  statsTitle: ['族譜統計', 'Family stats'],
  statPeople: ['人數', 'People'],
  statGenerations: ['代數', 'Generations'],
  statYears: ['年份範圍', 'Years covered'],
  statLiving: ['在世', 'Living'],
  chartGenerations: ['每代人數', 'People per generation'],
  chartDecades: ['各年代出生人數', 'Births by decade'],
  genN: ['第{n}代', 'Gen {n}'],
  decadeN: ['{n}年代', '{n}s'],
  notLinked: ['{n} 人未與他人連結', '{n} not linked to anyone'],
  noBirthYear: ['{n} 人沒有出生年份', '{n} with no birth year'],
  showTable: ['顯示表格', 'Show as table'],
  language: ['語言', 'Language'],

  nameZh: ['中文姓名', 'Chinese name'],
  pinyin: ['拼音', 'Pinyin'],
  badPinyin: ['不是有效的拼音', 'Not valid pinyin'],
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
  deceased: ['已故', 'Deceased'],
  year: ['年', 'Year'],
  month: ['月', 'Month'],
  day: ['日', 'Day'],
  notes: ['備註', 'Notes'],
  contact: ['聯絡方式', 'Contact'],
  email: ['電子郵件', 'Email'],
  phone: ['電話', 'Phone'],
  address: ['通訊地址', 'Mailing address'],
  line: ['LINE', 'LINE'],
  signal: ['Signal', 'Signal'],
  phoneHint: ['請加國碼', 'Include the country code'],
  lineHint: ['LINE ID（設定 → 個人檔案）', 'LINE ID (Settings → Profile)'],
  signalHint: ['使用者名稱（設定 → 個人檔案）', 'Username (Settings → Profile)'],
  badEmail: ['電子郵件格式不正確', 'Invalid email address'],
  badPhone: ['電話號碼不正確：請加國碼，不要加分機', 'Invalid phone number: include the country code, no extension'],
  badDate: ['日期不正確', 'Invalid date'],
  badYear: ['年份應為四位數字', 'the year must have 4 digits'],
  badMonth: ['月份應介於 1 到 12', 'the month must be 1 to 12'],
  badDay: ['日期應介於 1 到 31', 'the day must be 1 to 31'],
  monthNeedsYear: ['請一併填寫年份', 'enter the year too'],
  dayNeedsMonth: ['請一併填寫月份', 'enter the month too'],
  call: ['撥打', 'Call'],
  text: ['傳簡訊', 'Text'],
  copy: ['複製', 'Copy'],

  parents: ['父母', 'Parents'],
  spouses: ['伴侶', 'Partners'],
  marriage: ['婚姻', 'Marriage'],
  married: ['結婚', 'Married'],
  divorced: ['離婚', 'Divorced'],
  marriedDate: ['結婚日期', 'Marriage date'],
  divorcedDate: ['離婚日期', 'Divorce date'],
  marriageStatus: ['婚姻狀況', 'Status'],
  statusUnknown: ['不詳', 'Unknown'],
  statusMarried: ['已婚', 'Married'],
  statusDivorced: ['已離婚', 'Divorced'],
  statusUnmarried: ['未婚', 'Not married'],
  addMarriage: ['新增婚姻資料', 'Add marriage details'],
  editMarriage: ['編輯婚姻資料', 'Edit marriage details'],
  children: ['子女', 'Children'],
  siblings: ['兄弟姊妹', 'Siblings'],
  self: ['本人', 'This person'],
  fullSiblings: ['同父同母', 'Full siblings'],
  halfSiblingsPaternal: ['同父異母', 'Half siblings, same father'],
  halfSiblingsMaternal: ['同母異父', 'Half siblings, same mother'],
  halfPaternal: ['同父異母', 'Half · same father'],
  halfMaternal: ['同母異父', 'Half · same mother'],
  halfVia: ['同為{name}的子女', 'Half · through {name}'],
  onlyParent: ['只有{name}', 'Only {name}'],
  unknownOtherParent: ['另一位父母不詳', 'Other parent unknown'],

  edit: ['編輯', 'Edit'],
  add: ['新增', 'Add'],
  addParent: ['新增父母', 'Add parent'],
  addSpouse: ['新增伴侶', 'Add partner'],
  addChild: ['新增子女', 'Add child'],
  addSibling: ['新增兄弟姊妹', 'Add sibling'],
  addSpouseOrChild: ['新增伴侶或子女', 'Add partner or child'],
  addFirst: ['新增第一個人', 'Add the first person'],
  siblingNeedsParent: ['請先新增父母，才能新增兄弟姊妹', 'Add a parent before adding siblings'],
  parentsFull: ['已有兩位父母', 'Already has two parents'],
  hasOtherParent: ['{name}已有其他父母', '{name} already has another parent'],
  needsOneOrTwoParents: ['需有一或兩位不同的父母', 'Needs one or two different parents'],
  mustShareParent: ['需有共同的父母', 'Must share a parent'],
  cannotLinkSelf: ['不能把人連結到自己', "Can't link a person to themselves"],
  alreadySpouses: ['已是伴侶', 'Already partners'],
  alreadyParent: ['已是父母', 'Already a parent'],
  wouldLoop: ['會造成循環（子孫不能成為祖先的父母）', "Would create a loop (someone can't be a parent of their own ancestor)"],
  notSpouses: ['不是伴侶', 'Not partners'],
  notParent: ['不是父母', 'Not a parent'],
  parentKind: ['關係類型', 'Relationship type'],
  birthParent: ['親生', 'Birth'],
  adoptive: ['收養', 'Adoptive'],
  adoptiveParent: ['養父母', 'Adoptive parent'],
  adoptedChild: ['養子女', 'Adopted child'],
  editParentKinds: ['編輯父母關係', 'Edit parent relationships'],
  noParents: ['尚未記錄父母', 'No parents recorded'],
  sharesChildren: ['他們有共同的子女，請先移除父母關係', 'They share children; remove a parent link first'],
  personGone: ['此人已被刪除，請重新整理', 'This person no longer exists; please reload'],
  linkExisting: ['連結現有的人', 'Link existing person'],
  linkAs: ['關係', 'Relationship'],
  pickPerson: ['請先選擇一個人', 'Choose a person first'],
  asParent: ['是此人的父母', 'is a parent of this person'],
  asSpouse: ['是此人的伴侶', 'is a partner of this person'],
  asChild: ['是此人的子女', 'is a child of this person'],
  confirmUnlink: ['確定要移除這個關係嗎？', 'Remove this relationship?'],
  otherParent: ['另一位父母', 'Other parent'],
  otherParentNone: ['不詳或無', 'Unknown or none'],
  alsoParentOf: ['同時為這些子女的父母：', 'Also a parent of:'],
  delete: ['刪除', 'Delete'],
  confirmDelete: ['確定要刪除此人嗎？此操作會記錄在修改紀錄中，之後可以還原。', 'Delete this person? This is logged in the history and can be reverted.'],
  copied: ['已複製', 'Copied'],
  close: ['關閉', 'Close'],
  save: ['儲存', 'Save'],
  cancel: ['取消', 'Cancel'],
  saveFailed: ['儲存失敗', 'Save failed'],

  historyEmpty: ['尚無修改紀錄', 'No changes yet'],
  historyDetails: ['詳細資料', 'Details'],
  revert: ['還原', 'Revert'],
  confirmRevert: ['要將這些人還原到這次修改前的狀態嗎？之後對他們所做的修改也會被覆蓋。', 'Restore these people to how they were before this change? Later edits to them will be overwritten too.'],
  created: ['新增', 'Added'],
  deleted: ['刪除', 'Deleted'],
  offlineBanner: ['離線：顯示 {time} 的資料', 'Offline: showing data from {time}'],
  offlineNoEdit: ['離線時無法修改', "Can't make changes while offline"],
  signOutFailed: ['無法登出，請檢查網路連線後再試', "Couldn't sign out. Check your connection and try again."],
  installHint: ['安裝：瀏覽器選單 →「加到主畫面」或「安裝」', 'Install: browser menu → Add to Home screen (or Install)'],
  loadFailed: ['無法載入資料', "Couldn't load data"],

  more: ['更多', 'More'],
  menu: ['選單', 'Menu'],
  share: ['分享', 'Share'],
  recent: ['最近瀏覽', 'Recently viewed'],
  everyone: ['所有人', 'Everyone'],
  noneSelected: ['尚未選擇任何人', 'No one selected'],
  choosePerson: ['選擇一個人', 'Choose a person'],
  spousesChildren: ['伴侶與子女', 'Partners & children'],
  removeRelationship: ['移除關係', 'Remove relationship'],
  noRelationships: ['沒有可移除的關係', 'No relationships to remove'],
  remove: ['移除', 'Remove'],
  showInTree: ['在族譜中查看', 'Show in tree'],
  viewPerson: ['查看', 'View'],
  center: ['回到選取的人', 'Back to selected person'],
  fit: ['顯示整個族譜', 'Show the whole tree'],
  zoomIn: ['放大', 'Zoom in'],
  zoomOut: ['縮小', 'Zoom out'],
  treeControls: ['樹狀圖控制', 'Tree controls'],
  hidePane: ['隱藏人物面板', 'Hide person panel'],
  showPane: ['顯示人物面板', 'Show person panel'],
  treeKeysHint: ['用方向鍵在家人之間移動，按 Enter 選取', 'Arrow keys move between people; Enter selects'],
  change: ['更改', 'Change'],
  appearance: ['外觀', 'Appearance'],
  themeAuto: ['跟隨系統', 'System'],
  themeLight: ['淺色', 'Light'],
  themeDark: ['深色', 'Dark'],
  treeDirection: ['族譜方向', 'Tree direction'],
  treeAuto: ['自動', 'Auto'],
  treeVertical: ['直式', 'Vertical'],
  treeHorizontal: ['橫式', 'Horizontal'],
  tabTree: ['族譜', 'Tree'],
  tabPerson: ['人物', 'Person'],
  tabSearch: ['搜尋', 'Search'],
  tabMenu: ['選單', 'Menu'],
  navTabs: ['分頁', 'Tabs'],
  navTop: ['修改紀錄與設定', 'History and settings'],
  age: ['{n}歲', 'age {n}'],
  ageApprox: ['約{n}歲', 'about age {n}'],
  agedAtDeath: ['享年{n}歲', 'aged {n}'],
  agedAtDeathApprox: ['享年約{n}歲', 'aged about {n}'],
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

/** A label with {time} filled in with an already formatted time. */
export function tTime(key: Key, time: string): string {
  const [zh, en] = pairs[key]
  return join(zh.replace('{time}', time), en.replace('{time}', time))
}

/** A label with {name} filled in with a person's name. */
export function tName(key: Key, name: string): string {
  const [zh, en] = pairs[key]
  return join(zh.replace('{name}', name), en.replace('{name}', name))
}

/**
 * A label as a node for prominent UI text. With both languages, the English follows the
 * Chinese in a smaller, lighter span (stacked where CSS says so, e.g. in the tab bar).
 */
export function L(key: Key): Node {
  const [zh, en] = pairs[key]
  if (lang !== 'both' || zh === en) return document.createTextNode(join(zh, en))
  const frag = document.createDocumentFragment()
  frag.append(h('span', { class: 'zh', lang: 'zh-Hant' }, zh), ' ', h('span', { class: 'en', lang: 'en' }, en))
  return frag
}

/** BCP 47 locale for dates and times; the browser's own when showing both languages. */
export const locale: string | undefined = lang === 'zh' ? 'zh-TW' : lang === 'en' ? 'en' : undefined
