// Line icons from lucide, imported by name so the bundle only carries the ones used here.
// They draw with currentColor, so they follow the text color and theme on every OS (emoji didn't).
import {
  type IconNode, ChartColumn, Check, ChevronDown, ChevronRight, CodeXml, Copy, Ellipsis, History, Link, LocateFixed, LogOut, Maximize,
  Menu, MessageSquare, Minus, Network, PanelRightClose, PanelRightOpen, Pencil, Plus, Search, Settings, Share2, Trash2, Unlink, User, X, createElement,
} from 'lucide'

const icons = {
  chart: ChartColumn,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  close: X,
  copy: Copy,
  edit: Pencil,
  fit: Maximize,
  center: LocateFixed,
  history: History,
  link: Link,
  menu: Menu,
  message: MessageSquare,
  minus: Minus,
  more: Ellipsis,
  paneHide: PanelRightClose,
  paneShow: PanelRightOpen,
  person: User,
  plus: Plus,
  search: Search,
  settings: Settings,
  share: Share2,
  signOut: LogOut,
  source: CodeXml,
  trash: Trash2,
  tree: Network,
  unlink: Unlink,
} satisfies Record<string, IconNode>

export type IconName = keyof typeof icons

/** A decorative SVG icon, 1.25em square; the button or label next to it carries the accessible name. */
export function icon(name: IconName, cls = ''): SVGElement {
  return createElement(icons[name], {
    class: `icon ${cls}`.trim(), width: '1.25em', height: '1.25em', 'aria-hidden': 'true', focusable: 'false',
  })
}
