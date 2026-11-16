import { h } from './dom'
import { t } from './i18n'
import { confirmDialog, openDialog, toast } from './dialog'
import { FIELD_KEYS, type Person, displayName } from './model'
import type { Backend, ChangeRecord, PersonDiff } from './store'
import type { AppCtx } from './actions'

const FIELD_LABELS: Record<string, string> = {
  nameZh: t.nameZh, nameEn: t.nameEn, otherNames: t.otherNames, gender: t.gender,
  birthDate: t.birthDate, deathDate: t.deathDate, notes: t.notes,
  email: t.email, phone: t.phone, address: t.address, line: t.line, signal: t.signal, whatsapp: t.whatsapp,
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
    const fmt = (v: unknown) => (Array.isArray(v) ? ids(v) : String(v) || '—')
    lines.push(h('li', {}, `${FIELD_LABELS[k] ?? k}: `, h('del', {}, fmt(a)), ' → ', h('ins', {}, fmt(b))))
  }
  return lines
}

/** Change log dialog; stays live while open. */
export function openHistory(ctx: AppCtx, backend: Backend) {
  const list = h('ol', { class: 'history' }, h('li', { class: 'muted' }, t.loading))
  const render = (items: ChangeRecord[]) => {
    list.replaceChildren(...(items.length ? [] : [h('li', { class: 'muted' }, t.historyEmpty)]))
    for (const c of items) {
      const people = c.diffs.map(d => {
        const who = d.after ?? d.before
        return h('div', { class: 'diff' },
          h('button', { type: 'button', class: 'link', onclick: () => { if (ctx.store.people.has(d.id)) ctx.select(d.id) } },
            displayName(who ?? undefined)),
          h('ul', {}, ...diffLines(ctx, d)))
      })
      list.append(h('li', {},
        h('div', { class: 'history-head' },
          h('time', {}, new Date(c.at).toLocaleString()),
          h('strong', {}, c.editor),
        ),
        h('div', {}, c.summary),
        h('details', {}, h('summary', {}, t.historyDetails), ...people,
          h('button', {
            type: 'button', class: 'danger small', onclick: async () => {
              if (!(await confirmDialog(t.confirmRevert, t.revert, true))) return
              const editor = await ctx.editorName()
              if (!editor) return
              await ctx.store.revert(editor, c).catch(e => toast(`${t.saveFailed}: ${e.message}`))
            },
          }, t.revert)),
      ))
    }
  }
  const unsubscribe = backend.subscribeChanges(render, e => {
    list.replaceChildren(h('li', { class: 'dlg-error' }, `${t.loadFailed}: ${e.message}`))
  })
  openDialog(t.history, list, [], unsubscribe, 'tall')
}
