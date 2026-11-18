type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | boolean | ((e: Event) => void) | undefined>

/** Tiny element builder. Strings are always inserted as text, never HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, v)
  }
  for (const c of children) if (c) el.append(c)
  return el
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

type Query = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>
const query = (q: string, fallback: boolean): Query =>
  window.matchMedia?.(q) ?? { matches: fallback, addEventListener() {}, removeEventListener() {} }

/**
 * Tablets and computers show the tree and the person side by side; phones show one at a time.
 * A phone on its side is wide but short, so it keeps the phone layout. Same breakpoint as the
 * `(width >= 700px) and (height >= 500px)` queries in styles.css.
 */
export const wide = query('(min-width: 700px) and (min-height: 500px)', true)
export const reducedMotion = query('(prefers-reduced-motion: reduce)', false)
/** A touch screen, where the system share sheet beats copying a link. */
export const coarsePointer = query('(pointer: coarse)', false)
