import { h } from './dom'
import { L, locale, t } from './i18n'
import { confirmDialog, openDialog, toast } from './dialog'
import { marriageText } from './cards'
import { FIELD_KEYS, type Person, displayName, formatPhone } from './model'
import type { Backend, ChangeRecord, PersonDiff } from './store'
import type { AppCtx } from './actions'

const FIELD_LABELS: Record<string, string> = {
  nameZh: t.nameZh, nameEn: t.nameEn, otherNames: t.otherNames, gender: t.gender,
  birthDate: t.birthDate, deathDate: t.deathDate, notes: t.notes,
  email: t.email, phone: t.phone, address: t.address, line: t.line, signal: t.signal,
  parents: t.parents, spouses: t.spouses,
}

function diffLines(ctx: AppCtx, d: PersonDiff): Node[] {
  const name = (id: string) => displayName(ctx.store.people.get(id) ?? undefined)
  const ids = (list: string[]) => list.map(name).join(', ') || '—'
  if (!d.before) return [h('li', {}, `${t.created}: ${displayName(d.after!)}`)]
  if (!d.after) return [h('li', {}, `${t.deleted}: ${displayName(d.before)}`)]
  const lines: Node[] = []
  for (const k of [...FIELD_KEYS, 'parents', 'spouses'] as (keyof Person)[]) {
    const [a, b] = [d.before[k], d.after[k]]
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    const fmt = (v: unknown) => (Array.isArray(v) ? ids(v) : (k === 'phone' ? formatPhone(String(v)) : String(v)) || '—')
    lines.push(h('li', {}, `${FIELD_LABELS[k] ?? k}: `, h('del', {}, fmt(a)), ' → ', h('ins', {}, fmt(b))))
  }
  // Snapshots from before marriages existed lack the field.
  const [ma, mb] = [d.before.marriages ?? {}, d.after.marriages ?? {}]
  for (const sid of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    if (JSON.stringify(ma[sid]) === JSON.stringify(mb[sid])) continue
    lines.push(h('li', {}, `${t.marriage} (${name(sid)}): `,
      h('del', {}, marriageText(ma[sid]) || '—'), ' → ', h('ins', {}, marriageText(mb[sid]) || '—')))
  }
  return lines
}

/** Change log dialog, grouped by day; stays live while open. With `personId`, only changes that touched that person. */
export function openHistory(ctx: AppCtx, backend: Backend, personId?: string) {
  const list = h('div', { class: 'history' }, h('p', { class: 'muted' }, t.loading))
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  const render = (all: ChangeRecord[]) => {
    const items = personId ? all.filter(c => c.diffs.some(d => d.id === personId)) : all
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
            displayName(who ?? undefined)),
          h('ul', {}, ...diffLines(ctx, d)))
      })
      ol.append(h('li', { class: 'history-item' },
        h('div', { class: 'history-head' },
          h('strong', {}, c.editor),
          h('time', { datetime: date.toISOString() }, timeFmt.format(date)),
        ),
        h('div', { class: 'history-summary' }, c.summary),
        h('details', {}, h('summary', {}, L('historyDetails')), ...people,
          h('button', {
            type: 'button', class: 'danger small', onclick: async () => {
              if (!(await confirmDialog(t.confirmRevert, t.revert, true))) return
              const editor = await ctx.editorName()
              if (!editor) return
              await ctx.store.revert(editor, c).catch(e => toast(`${t.saveFailed}: ${e.message}`))
            },
          }, L('revert'))),
      ))
    }
  }
  const unsubscribe = backend.subscribeChanges(render, e => {
    list.replaceChildren(h('p', { class: 'dlg-error' }, `${t.loadFailed}: ${e.message}`))
  })
  const who = personId ? ctx.store.people.get(personId) : undefined
  openDialog(L(personId ? 'personHistory' : 'history'), list, [],
    { onDismiss: unsubscribe, cls: 'tall history-dlg', subtitle: who ? displayName(who) : undefined })
}
