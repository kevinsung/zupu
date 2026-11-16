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
