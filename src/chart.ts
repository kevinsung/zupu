import * as f3 from 'family-chart'
import 'family-chart/styles/family-chart.css'
import * as d3 from 'd3'
import { type People, allNames, displayName, lifespan } from './model'
import { escapeHtml, reducedMotion } from './dom'
import { t } from './i18n'

/** Id of a visually hidden element (in the tree pane) that explains the arrow keys. */
export const TREE_HINT_ID = 'tree-keys-hint'

const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** Wraps family-chart so the rest of the app only deals in People and ids. */
export class TreeChart {
  private chart: f3.Chart | null = null

  /** `compact` uses smaller cards and spacing so more of the tree fits on a phone. */
  constructor(private cont: HTMLElement, private onSelect: (id: string) => void, private compact = false) {
    cont.classList.toggle('compact', compact)
    // The tree is one tab stop (the selected person's card). Arrow keys move between cards by
    // where they sit on screen, Home goes back to the selected person, and Enter or Space selects.
    cont.addEventListener('keydown', e => {
      const card = (e.target as Element).closest<HTMLElement>('.ft-card[data-id]')
      if (!card) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.refocus = true
        this.onSelect(card.dataset.id!)
      } else if (e.key in STEPS || e.key === 'Home') {
        const next = e.key === 'Home' ? this.mainCard() : this.nearest(card, STEPS[e.key])
        e.preventDefault()
        if (next) this.focusCard(next)
      }
    })
  }

  /** The selected person, as of the last render; their card is the tree's tab stop. */
  private mainId = ''

  private cards() {
    return [...this.cont.querySelectorAll<HTMLElement>('.ft-card[data-id]')]
  }

  private mainCard() {
    return this.cards().find(el => el.dataset.id === this.mainId)
  }

  /**
   * The card nearest to `from` in direction [dx, dy], by screen position. Distance across the
   * direction counts double, so ArrowRight prefers the card straight ahead over a nearer one
   * off to the side.
   */
  private nearest(from: HTMLElement, [dx, dy]: [number, number]) {
    const center = (el: Element) => {
      const r = el.getBoundingClientRect()
      return [r.left + r.width / 2, r.top + r.height / 2]
    }
    const [x0, y0] = center(from)
    let best: HTMLElement | undefined
    let bestScore = Infinity
    for (const el of this.cards()) {
      if (el === from || el.dataset.id === from.dataset.id) continue
      const [x, y] = center(el)
      const along = (x - x0) * dx + (y - y0) * dy
      if (along <= 1) continue
      const score = along + 2 * (Math.abs((x - x0) * dy) + Math.abs((y - y0) * dx))
      if (score < bestScore) { bestScore = score; best = el }
    }
    return best
  }

  /** Moves the tab stop and focus to a card, panning the tree if the card is near or past an edge. */
  private focusCard(el: HTMLElement) {
    for (const c of this.cards()) c.tabIndex = c === el ? 0 : -1
    el.focus({ preventScroll: true })
    const target = this.zoomTarget()
    if (!target?.__zoomObj) return
    const r = el.getBoundingClientRect()
    const box = this.cont.getBoundingClientRect()
    const m = 24
    const shift = (lo: number, hi: number, min: number, max: number) =>
      lo < min + m ? min + m - lo : hi > max - m ? max - m - hi : 0
    const dx = shift(r.left, r.right, box.left, box.right)
    const dy = shift(r.top, r.bottom, box.top, box.bottom)
    if (!dx && !dy) return
    const k = d3.zoomTransform(target).k
    d3.select(target).transition().duration(reducedMotion.matches ? 0 : 250).call(target.__zoomObj.translateBy, dx / k, dy / k)
  }

  /** Set when a card was chosen from the keyboard, so focus follows it into the redrawn tree. */
  private refocus = false

  private get transition() {
    return reducedMotion.matches ? 0 : 600
  }

  private toData(people: People): f3.Data {
    const children = new Map<string, string[]>()
    for (const p of people.values()) {
      for (const parent of p.parents) if (people.has(parent)) children.set(parent, [...(children.get(parent) ?? []), p.id])
    }
    return [...people.values()].map(p => ({
      id: p.id,
      // family-chart types gender as M|F but renders anything else as "genderless".
      data: { gender: p.gender as 'M' | 'F', order: p.order, birthDate: p.birthDate, person: p },
      rels: {
        parents: p.parents.filter(id => people.has(id)),
        spouses: p.spouses.filter(id => people.has(id)),
        children: children.get(p.id) ?? [],
      },
    }))
  }

  /** Forget the current chart (its DOM was replaced, e.g. by the empty-tree screen). */
  reset() {
    this.chart = null
    this.cont.replaceChildren()
  }

  render(people: People, mainId: string, recenter: boolean) {
    const data = this.toData(people)
    if (data.length === 0) return
    this.mainId = mainId
    // Cards are redrawn from scratch, so remember which one had focus to put it back.
    const focused = this.cont.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).closest<HTMLElement>('.ft-card[data-id]')?.dataset.id
      : undefined
    if (!this.chart) {
      this.chart = f3.createChart(this.cont, data)
        .setTransitionTime(this.transition)
        // Generations run left to right, so siblings and cousins stack in a column rather than
        // spreading sideways off a narrow screen. Spacings keep their screen axes.
        .setOrientationHorizontal()
        .setCardXSpacing(this.compact ? 140 : 190)
        .setCardYSpacing(this.compact ? 72 : 85)
        .setSingleParentEmptyCard(false)
        .setShowSiblingsOfMain(true)
        .setSortChildrenFunction((a, b) => {
          const [x, y] = [a.data, b.data]
          if (x.birthDate && y.birthDate && x.birthDate !== y.birthDate) return x.birthDate < y.birthDate ? -1 : 1
          return x.order - y.order
        })
      this.chart.setCardHtml()
        .setCardInnerHtmlCreator(d => {
          const p = d.data.data.person
          const name = displayName(p)
          const sub = allNames(p).filter(n => n !== name).join(' · ')
          const gender = p.gender === 'M' ? t.maleWord : p.gender === 'F' ? t.femaleWord : ''
          const label = [name, gender, sub, lifespan(p)].filter(Boolean).join(', ')
          const main = p.id === this.mainId
          return `<div class="ft-card ft-${p.gender || 'U'}" data-id="${escapeHtml(p.id)}" tabindex="${main ? 0 : -1}" role="button"${main ? ' aria-current="true"' : ''} aria-label="${escapeHtml(label)}" aria-describedby="${TREE_HINT_ID}">
            <div class="ft-name">${escapeHtml(name)}</div>
            ${sub ? `<div class="ft-sub">${escapeHtml(sub)}</div>` : ''}
            ${lifespan(p) ? `<div class="ft-years">${escapeHtml(lifespan(p))}</div>` : ''}
          </div>`
        })
        .setOnCardClick((_e: MouseEvent, d: { data: { id: string } }) => this.onSelect(d.data.id))
      // family-chart pans with transforms, so its overflow:hidden canvas should never scroll. But when
      // the pointer is over a card during a re-layout, Chrome scrolls it anyway, pushing the
      // selected person off-screen. Undo any such scroll.
      const canvas = this.cont.querySelector<HTMLElement>('#f3Canvas')
      canvas?.addEventListener('scroll', () => { canvas.scrollLeft = 0; canvas.scrollTop = 0 })
      this.chart.updateMainId(mainId)
      // Not `initial: true`: family-chart then ignores tree_position and fits the whole tree,
      // which shrinks a big family to unreadable cards.
      this.chart.updateTree({ initial: false, tree_position: 'inherit', transition_time: 0 })
      this.center(0)
      return
    }
    this.chart.updateData(data)
    this.chart.updateMainId(mainId)
    this.chart.updateTree({ tree_position: 'inherit', transition_time: this.transition })
    if (recenter) this.center()
    const refocus = this.refocus ? mainId : focused
    this.refocus = false
    if (refocus) {
      requestAnimationFrame(() => {
        const el = this.cards().find(c => c.dataset.id === refocus)
        if (!el) return
        if (refocus !== mainId) for (const c of this.cards()) c.tabIndex = c === el ? 0 : -1
        el.focus({ preventScroll: true })
      })
    }
  }

  /** Zoom out (or in) so the whole tree fits the pane. */
  fit() {
    this.chart?.updateTree({ tree_position: 'fit', transition_time: this.transition })
  }

  /** The element d3-zoom is attached to, if the chart exists. */
  private zoomTarget(): (Element & { __zoomObj?: d3.ZoomBehavior<Element, unknown> }) | null {
    const svg = this.chart?.svg as (SVGElement & { __zoomObj?: unknown }) | undefined
    if (!svg) return null
    return (svg.__zoomObj ? svg : svg.parentNode) as Element & { __zoomObj?: d3.ZoomBehavior<Element, unknown> }
  }

  /** Pan so the selected person is in the middle, keeping the current zoom level. */
  center(transition = this.transition) {
    const el = this.zoomTarget()
    const main = this.chart?.store.getTree() && this.chart.store.getTreeMainDatum()
    if (!el?.__zoomObj || !main) return
    const { width, height } = this.cont.getBoundingClientRect()
    const k = d3.zoomTransform(el).k
    d3.select(el).transition().duration(transition)
      .call(el.__zoomObj.transform, d3.zoomIdentity.translate(width / 2 - main.x * k, height / 2 - main.y * k).scale(k))
  }

  zoom(factor: number) {
    const el = this.zoomTarget()
    if (el?.__zoomObj) d3.select(el).transition().duration(reducedMotion.matches ? 0 : 250).call(el.__zoomObj.scaleBy, factor)
  }
}
