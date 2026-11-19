import { h } from './dom'
import { L, t, tn, type Key } from './i18n'
import { personCard } from './cards'
import {
  type People, type Person, byBirth, childrenIndex, isDeceased, partnerIds, rankPeople, seniorAncestor,
} from './model'

const yearOf = (p: Person): number | null => {
  const y = p.birthDate.slice(0, 4)
  return /^\d{4}$/.test(y) ? Number(y) : null
}

/**
 * Everything the stats page shows, as lists of people (counts are their lengths) so a bar can
 * list who is in it. Each list is in birth order.
 */
export function computeStats(people: People) {
  const all = [...people.values()].sort(byBirth)
  // Living unless marked deceased or given a death date; no one is presumed dead from their age.
  const living = all.filter(p => !isDeceased(p))
  const gender = { M: all.filter(p => p.gender === 'M'), F: all.filter(p => p.gender === 'F'), U: all.filter(p => !p.gender) }

  // Generations: a child is one below their parent and partners share a generation. Walk each
  // connected family from its top (first visit wins, so cousin marriages can't loop), then shift
  // it so its eldest generation is 1. A partner who married in gets their spouse's generation.
  const kids = childrenIndex(people)
  const parentsOf = (p: Person) => p.parents.filter(id => people.has(id))
  const neighbors = (p: Person): [string, number][] => [
    ...parentsOf(p).map((id): [string, number] => [id, -1]),
    ...(kids.get(p.id) ?? []).map((id): [string, number] => [id, 1]),
    ...partnerIds(people, p).map((id): [string, number] => [id, 0]),
  ]
  const level = new Map<string, number>()
  const components: Person[][] = []
  const walk = (start: Person) => {
    const found = new Map([[start.id, 0]])
    const queue = [start.id]
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      for (const [next, step] of neighbors(people.get(id)!)) {
        if (found.has(next) || level.has(next)) continue
        found.set(next, found.get(id)! + step)
        queue.push(next)
      }
    }
    const top = Math.min(...found.values())
    for (const [id, g] of found) level.set(id, g - top + 1)
    components.push(queue.map(id => people.get(id)!))
  }
  const senior = seniorAncestor(people)
  if (senior) walk(senior)
  const unlinked: Person[] = []
  for (const p of rankPeople(people)) {
    if (level.has(p.id)) continue
    if (neighbors(p).length) walk(p)
    else unlinked.push(p)
  }
  const generations: Person[][] = []
  for (const comp of components) {
    for (const p of comp) (generations[level.get(p.id)! - 1] ??= []).push(p)
  }
  generations.forEach(g => g.sort(byBirth))
  unlinked.sort(byBirth)

  const years = all.map(yearOf).filter((y): y is number => y !== null)
  const firstYear = years.length ? Math.min(...years) : null
  const lastYear = years.length ? Math.max(...years) : null
  const decades: { decade: number, people: Person[] }[] = []
  if (firstYear !== null && lastYear !== null) {
    const decadeOf = (y: number) => Math.floor(y / 10) * 10
    for (let d = decadeOf(firstYear); d <= decadeOf(lastYear); d += 10) decades.push({ decade: d, people: [] })
    for (const p of all) {
      const y = yearOf(p)
      if (y !== null) decades[(decadeOf(y) - decades[0].decade) / 10].people.push(p)
    }
  }
  const noBirthYear = all.filter(p => yearOf(p) === null)
  return { total: all.length, living, gender, generations, unlinked, decades, noBirthYear, firstYear, lastYear }
}

type Stats = ReturnType<typeof computeStats>

/** One bar, column or segment: tapping it lists `people` under its chart. */
interface Bucket { key: string, name: string, people: Person[] }

/**
 * The 族譜統計 page: headline numbers, then charts of people per generation, births per decade and
 * gender. Every bar is a button that lists the people in it; each chart also has a table.
 * `refresh` rebuilds from the current people, keeping open lists whose bar still exists.
 */
export function statsPage(people: () => People, select: (id: string) => void) {
  // The open bucket's key for each chart, kept across rebuilds.
  const open = new Map<string, string>()
  const body = h('div', { class: 'stats' })
  const heading = h('h1', { class: 'stats-title', tabindex: '-1' }, L('statsTitle'))
  const el = h('div', { class: 'stats-page' }, heading, body)

  const tile = (label: Key, value: string, cls = '') =>
    h('div', { class: 'tile' },
      h('div', { class: `tile-value ${cls}`.trim() }, value),
      h('div', { class: 'tile-label' }, L(label)))

  /**
   * A titled chart. `draw` gets a function that makes the button for a bucket (children are what it
   * shows) and returns the chart; `table` is the same numbers as rows.
   */
  function chart(id: string, title: Key, buckets: Bucket[], draw: (bar: (b: Bucket, cls: string, ...kids: (Node | string)[]) => HTMLElement) => Node,
    table: { head: string[], rows: string[][] }, ...notes: (Node | null)[]) {
    if (!buckets.some(b => b.key === open.get(id) && b.people.length)) open.delete(id)
    const listId = `stat-list-${id}`
    const list = h('div', { id: listId, class: 'stat-list', hidden: true })
    const section = h('section', { class: 'stat-chart', 'aria-labelledby': `stat-h-${id}` })

    function sync() {
      const b = buckets.find(x => x.key === open.get(id))
      section.querySelectorAll<HTMLElement>('[data-key]').forEach(btn => {
        const on = btn.dataset.key === b?.key
        btn.setAttribute('aria-expanded', String(on))
        btn.classList.toggle('open', on)
      })
      list.hidden = !b
      if (!b) { list.replaceChildren(); return }
      list.replaceChildren(
        h('h3', { class: 'section-title' }, `${b.name}: ${b.people.length}`),
        h('div', { class: 'cards' }, ...b.people.map(p => personCard(p, () => select(p.id)))))
    }
    const bar = (b: Bucket, cls: string, ...kids: (Node | string)[]) => {
      const n = b.people.length
      const label = `${b.name}: ${n}`
      return h('button', {
        type: 'button', class: `${cls}${n ? '' : ' none'}`, 'data-key': b.key, 'aria-label': label, title: label,
        'aria-expanded': 'false', 'aria-controls': listId, disabled: !n,
        onclick: () => { if (open.get(id) === b.key) open.delete(id); else open.set(id, b.key); sync() },
      }, ...kids)
    }
    section.append(
      h('h2', { class: 'stat-title', id: `stat-h-${id}` }, L(title)),
      draw(bar),
      ...notes.filter((n): n is Node => !!n),
      list,
      h('details', { class: 'stat-table' },
        h('summary', {}, L('showTable')),
        h('table', {},
          h('thead', {}, h('tr', {}, ...table.head.map(c => h('th', { scope: 'col' }, c)))),
          h('tbody', {}, ...table.rows.map(([label, ...cells]) =>
            h('tr', {}, h('th', { scope: 'row' }, label), ...cells.map(c => h('td', {}, c))))))))
    sync()
    return section
  }

  const note = (text: string) => h('p', { class: 'stat-note' }, text)

  function generationsChart(s: Stats) {
    const buckets = s.generations.map((g, i) => ({ key: String(i + 1), name: tn('genN', i + 1), people: g }))
    const max = Math.max(1, ...buckets.map(b => b.people.length))
    return chart('gen', 'chartGenerations', buckets,
      bar => h('div', { class: 'hbars' }, ...buckets.map(b => {
        const fill = h('span', { class: 'hbar-fill' })
        fill.style.setProperty('--p', String(b.people.length / max))
        return bar(b, 'hbar', h('span', { class: 'hbar-label' }, b.name), h('span', { class: 'hbar-track' }, fill, h('span', { class: 'hbar-count' }, String(b.people.length))))
      })),
      { head: [t.chartGenerations, t.statPeople], rows: buckets.map(b => [b.name, String(b.people.length)]) },
      s.unlinked.length ? note(tn('notLinked', s.unlinked.length)) : null)
  }

  function decadesChart(s: Stats) {
    const buckets = s.decades.map(d => ({ key: String(d.decade), name: tn('decadeN', d.decade), people: d.people }))
    const max = Math.max(1, ...buckets.map(b => b.people.length))
    return chart('decade', 'chartDecades', buckets,
      bar => h('div', { class: 'cols' }, ...buckets.map(b => {
        const n = b.people.length
        const fill = h('span', { class: 'col-fill' })
        fill.style.setProperty('--h', `${(n / max) * 100}%`)
        const decade = String(Number(b.key))
        // The full decade doesn't fit under a column on a phone, so a short form stands in there.
        return bar(b, `col${n === max ? ' top' : ''}`,
          h('span', { class: 'col-count' }, String(n)),
          h('span', { class: 'col-track' }, fill),
          h('span', { class: 'col-label', 'aria-hidden': 'true' },
            h('span', { class: 'col-full' }, decade), h('span', { class: 'col-short' }, h('span', {}, decade.slice(0, 2)), h('span', {}, decade.slice(2)))))
      })),
      { head: [t.chartDecades, t.statPeople], rows: buckets.map(b => [b.name, String(b.people.length)]) },
      s.noBirthYear.length ? note(tn('noBirthYear', s.noBirthYear.length)) : null)
  }

  function genderChart(s: Stats) {
    const kinds: [string, Key, Person[]][] = [['M', 'male', s.gender.M], ['F', 'female', s.gender.F], ['U', 'unknownGender', s.gender.U]]
    const buckets = kinds.map(([key, label, list]) => ({ key, name: t[label], people: list }))
    const pct = (n: number) => `${Math.round((n / (s.total || 1)) * 100)}%`
    return chart('gender', 'gender', buckets,
      bar => h('div', {},
        h('div', { class: 'split' }, ...buckets.filter(b => b.people.length).map(b => {
          const btn = bar(b, `split-seg g-${b.key}`)
          btn.style.flexGrow = String(b.people.length)
          return btn
        })),
        h('ul', { class: 'legend' }, ...buckets.map(b =>
          h('li', {}, h('span', { class: `swatch g-${b.key}`, 'aria-hidden': 'true' }), `${b.name} ${b.people.length} (${pct(b.people.length)})`)))),
      { head: [t.gender, t.statPeople, '%'], rows: buckets.map(b => [b.name, String(b.people.length), pct(b.people.length)]) })
  }

  function refresh() {
    const s = computeStats(people())
    const years = s.firstYear === null ? '—' : s.firstYear === s.lastYear ? String(s.firstYear) : `${s.firstYear}–${s.lastYear}`
    body.replaceChildren(
      h('div', { class: 'tiles' },
        tile('statPeople', String(s.total)),
        tile('statGenerations', String(s.generations.length)),
        tile('statYears', years, 'range'),
        tile('statLiving', String(s.living.length))),
      generationsChart(s), decadesChart(s), genderChart(s))
  }
  // Built on the first refresh, once the data is in: before that it would show all zeros.
  return { el, refresh }
}
