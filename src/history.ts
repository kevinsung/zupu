import { h } from './dom'
import { L, locale, pair, t } from './i18n'
import { errorText } from './errors'
import { confirmDialog, openDialog, toast } from './dialog'
import { marriageText } from './cards'
import { FIELD_KEYS, displayName, formatPhone } from './model'
import type { ChangeRecord, PersonDiff } from './ops'
import { watchChanges } from './backend'
import { type AppCtx, canEdit } from './actions'

function diffLines(ctx: AppCtx, d: PersonDiff): Node[] {
  const name = (id: string) => displayName(ctx.store.people.get(id))
  const ids = (list: string[]) => list.map(name).join(', ') || '—'
  if (!d.before) return [h('li', {}, `${t.created}: ${displayName(d.after!)}`)]
  if (!d.after) return [h('li', {}, `${t.deleted}: ${displayName(d.before)}`)]
  const lines: Node[] = []
  // Each key doubles as the i18n key of its label.
  for (const k of [...FIELD_KEYS, 'parents', 'spouses'] as const) {
    const [a, b] = [d.before[k], d.after[k]]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    const fmt = (v: unknown) => (Array.isArray(v) ? ids(v) : (k === 'phone' ? formatPhone(String(v)) : k === 'deceased' && v === 'yes' ? t.deceased : String(v)) || '—')
    lines.push(h('li', {}, `${t[k]}: `, h('del', {}, fmt(a)), ' → ', h('ins', {}, fmt(b))))
  }
  // The raw values are timestamps, so just say it changed.
  if (d.before.order !== d.after.order) lines.push(h('li', {}, t.birthOrderChanged))
  // Snapshots from before marriages existed lack the field.
  const [ma, mb] = [d.before.marriages ?? {}, d.after.marriages ?? {}]
  for (const sid of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    if (JSON.stringify(ma[sid]) === JSON.stringify(mb[sid])) continue
    lines.push(h('li', {}, `${t.marriage} (${name(sid)}): `,
      h('del', {}, marriageText(ma[sid]) || '—'), ' → ', h('ins', {}, marriageText(mb[sid]) || '—')))
  }
  const [ka, kb] = [d.before.parentKinds ?? {}, d.after.parentKinds ?? {}]
  const kindLabel = (k: string | undefined) => (k ? t[k as 'adoptive'] : t.birthParent)
  for (const pid of new Set([...Object.keys(ka), ...Object.keys(kb)])) {
    if (ka[pid] === kb[pid]) continue
    lines.push(h('li', {}, `${t.parentKind} (${name(pid)}): `, h('del', {}, kindLabel(ka[pid])), ' → ', h('ins', {}, kindLabel(kb[pid]))))
  }
  return lines
}

/** Change log dialog, grouped by day; stays live while open. With `personId`, only changes that touched that person. */
export function openHistory(ctx: AppCtx, personId?: string) {
  const list = h('div', { class: 'history' }, h('p', { class: 'muted' }, t.loading))
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  const controls = (li: Element) => [...li.querySelectorAll<HTMLElement>('summary, button')]
  const render = (all: ChangeRecord[]) => {
    const items = personId ? all.filter(c => c.diffs.some(d => d.id === personId)) : all
    // Every change (a revert from here, too) rebuilds the list. Keep which details were open and
    // which control had focus, by change id, instead of collapsing them and dropping focus.
    const open = new Set([...list.querySelectorAll('details[open]')].map(d => d.closest<HTMLElement>('li[data-id]')?.dataset.id))
    const active = document.activeElement
    const activeLi = active && list.contains(active) ? active.closest<HTMLElement>('li[data-id]') : null
    const focusAt = activeLi ? { id: activeLi.dataset.id, index: controls(activeLi).indexOf(active as HTMLElement) } : null
    list.replaceChildren(...(items.length ? [] : [h('p', { class: 'muted' }, t.historyEmpty)]))
    let day = ''
    let ol: HTMLElement | null = null
    for (const c of items) {
      const date = new Date(c.at)
      const label = dayFmt.format(date)
      if (label !== day || !ol) {
        day = label
        ol = h('ol', {})
        list.append(h('section', { class: 'history-day' }, h('h3', {}, label), ol))
      }
      const people = c.diffs.map(d => {
        const who = d.after ?? d.before
        return h('div', { class: 'diff' },
          h('button', { type: 'button', class: 'link', onclick: () => { if (ctx.store.people.has(d.id)) ctx.select(d.id) } },
            displayName(who)),
          h('ul', {}, ...diffLines(ctx, d)))
      })
      ol.append(h('li', { class: 'history-item', 'data-id': c.id },
        h('div', { class: 'history-head' },
          h('strong', {}, c.editor),
          h('time', { datetime: date.toISOString() }, timeFmt.format(date)),
        ),
        h('div', { class: 'history-summary' }, c.summary),
        h('details', { open: open.has(c.id) }, h('summary', {}, L('historyDetails')), ...people,
          h('button', {
            type: 'button', class: 'danger small', onclick: async () => {
              if (!canEdit()) return
              if (!(await confirmDialog(t.confirmRevert, t.revert, true))) return
              const editor = await ctx.editorName()
              if (!editor) return
              await ctx.store.revert(editor, c).catch(e => toast(errorText(e, pair('saveFailed')), { error: true }))
            },
          }, L('revert'))),
      ))
    }
    if (!focusAt) return
    const li = [...list.querySelectorAll<HTMLElement>('li[data-id]')].find(el => el.dataset.id === focusAt.id)
    // A new change goes on top and pushes the rest down, so let focus() scroll the control into view.
    const target = li ? controls(li)[focusAt.index] ?? controls(li)[0] : list.querySelector<HTMLElement>('summary')
    ;(target ?? list.closest('dialog')?.querySelector<HTMLElement>('.dlg-x'))?.focus()
  }
  const unsubscribe = watchChanges(render, e => {
    list.replaceChildren(h('p', { class: 'dlg-error' }, errorText(e, pair('loadFailed'))))
  })
  const who = personId ? ctx.store.people.get(personId) : undefined
  openDialog(L(personId ? 'personHistory' : 'history'), list, [],
    { onDismiss: unsubscribe, cls: 'tall history-dlg', subtitle: who ? displayName(who) : undefined })
}
