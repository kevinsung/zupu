import * as f3 from 'family-chart'
import 'family-chart/styles/family-chart.css'
import * as d3 from 'd3'
import { type People, allNames, byBirth, childrenIndex, displayName, lifespan, partnerIds } from './model'
import { escapeHtml, reducedMotion } from './dom'
import { genderWord } from './cards'

/** Id of a visually hidden element (in the tree pane) that explains the arrow keys. */
export const TREE_HINT_ID = 'tree-keys-hint'

const DIRECTION_KEY = 'ft-tree-direction'

type Orientation = 'vertical' | 'horizontal'

/**
 * Which way generations run: down the screen, across it, or (the default) whichever suits the
 * tree pane's shape, so a wide pane gets a vertical tree and a tall one a horizontal tree.
 */
export type TreeDirection = 'auto' | Orientation

export function getTreeDirection(): TreeDirection {
  const v = localStorage.getItem(DIRECTION_KEY)
  return v === 'vertical' || v === 'horizontal' ? v : 'auto'
}

export function setTreeDirection(direction: TreeDirection) {
  if (direction === 'auto') localStorage.removeItem(DIRECTION_KEY)
  else localStorage.setItem(DIRECTION_KEY, direction)
}

export interface TreeLayout {
  direction: TreeDirection
  /** Smaller cards and spacing so more of the tree fits on a phone. */
  compact: boolean
}
/**
 * Screen-axis card spacing [x, y] for each layout: card size plus a gap. Cards are 120px wide, or
 * 116px when compact (#chart .ft-card in styles.css), whichever way the tree runs. Their height
 * depends on how many lines the name may take: up to two in a vertical tree (cards up to 94px
 * tall, 83px compact) and one in a horizontal tree, where siblings stack (73px, 64px compact).
 */
const SPACING: Record<Orientation, Record<'full' | 'compact', [number, number]>> = {
  vertical: { full: [145, 120], compact: [135, 105] },
  horizontal: { full: [160, 85], compact: [140, 72] },
}

const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** Wraps family-chart so the rest of the app only deals in People and ids. */
export class TreeChart {
  private chart: f3.Chart | null = null
  /** The selected person, as of the last render; their card is the tree's tab stop. */
  private mainId = ''
  /** Set when a card was chosen from the keyboard, so focus follows it into the redrawn tree. */
  private refocus = false

  private layout: TreeLayout = { direction: 'auto', compact: false }
  /** The orientation the chart is set to, which `auto` may change when the pane is resized. */
  private drawn: Orientation | null = null

  constructor(private cont: HTMLElement, private onSelect: (id: string) => void, layout: TreeLayout) {
    this.setLayout(layout)
    // When the pane is resized (a window, a rotated tablet, the person pane hidden or shown), keep
    // what was in the middle there, or with `auto`, turn the tree if the pane changed shape.
    // A hidden pane measures 0×0; it's laid out again when shown.
    let [w0, h0] = [0, 0]
    new ResizeObserver(() => {
      const [w, h] = [cont.clientWidth, cont.clientHeight]
      const resized = w0 && h0 && (w !== w0 || h !== h0)
      const [dx, dy] = [(w - w0) / 2, (h - h0) / 2]
      ;[w0, h0] = [w, h]
      if (!this.chart || !w || !h) return
      if (this.applyLayout()) {
        this.chart.updateTree({ tree_position: 'inherit', transition_time: this.transition })
        this.center()
      } else if (resized) {
        this.panBy(dx, dy)
      }
    }).observe(cont)
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

  /**
   * Moves the tab stop and focus to a card, panning the tree if the card is near or past an edge,
   * or under the bar or zoom tools that sit over the tree.
   */
  private focusCard(el: HTMLElement, pan = true) {
    for (const c of this.cards()) c.tabIndex = c === el ? 0 : -1
    el.focus({ preventScroll: true })
    const target = this.zoomTarget()
    if (!pan || !target?.__zoomObj) return
    const r = el.getBoundingClientRect()
    let { left, top, right, bottom } = this.cont.getBoundingClientRect()
    // Hidden overlays (display: none) measure 0×0. The bar under the tree spans its width, so it
    // only lowers the bottom edge; the narrow tools only matter to cards level with them.
    const overlay = (sel: string) => {
      const o = this.cont.parentElement?.querySelector(sel)?.getBoundingClientRect()
      return o && o.width && o.height ? o : null
    }
    const peek = overlay('.peek')
    if (peek) bottom = Math.min(bottom, peek.top)
    const tools = overlay('.chart-tools')
    if (tools && r.bottom > tools.top && r.top < tools.bottom) right = Math.min(right, tools.left)
    const m = 24
    const shift = (lo: number, hi: number, min: number, max: number) =>
      lo < min + m ? min + m - lo : hi > max - m ? max - m - hi : 0
    const dx = shift(r.left, r.right, left, right)
    const dy = shift(r.top, r.bottom, top, bottom)
    if (!dx && !dy) return
    const k = d3.zoomTransform(target).k
    d3.select(target).transition().duration(this.panMs).call(target.__zoomObj.translateBy, dx / k, dy / k)
  }

  /**
   * Focuses the selected person's card, e.g. when "Show in tree" hides the page that had focus.
   * Callers center the tree on that card first, so no panning, which would cut that short.
   */
  focusMain() {
    const el = this.mainCard()
    if (el) this.focusCard(el, false)
  }

  /** Duration of a re-layout. */
  private get transition() {
    return reducedMotion.matches ? 0 : 600
  }

  /** Duration of a pan or zoom from the keyboard or the zoom buttons. */
  private get panMs() {
    return reducedMotion.matches ? 0 : 250
  }

  private toData(people: People): f3.Data {
    const children = childrenIndex(people)
    return [...people.values()].map(p => ({
      id: p.id,
      // family-chart types gender as M|F but renders anything else as "genderless".
      data: { gender: p.gender as 'M' | 'F', person: p },
      rels: {
        parents: p.parents.filter(id => people.has(id)),
        // Co-parents too, so a couple is drawn the same way in both directions.
        spouses: partnerIds(people, p),
        children: children.get(p.id) ?? [],
      },
    }))
  }

  /** Changes any part of the layout. Call render() afterwards to redraw an existing tree. */
  setLayout(layout: Partial<TreeLayout>) {
    this.layout = { ...this.layout, ...layout }
    this.cont.classList.toggle('compact', this.layout.compact)
    this.applyLayout()
  }

  private orientation(): Orientation {
    const { direction } = this.layout
    if (direction !== 'auto') return direction
    return this.cont.clientWidth > this.cont.clientHeight ? 'vertical' : 'horizontal'
  }

  /** Sets the chart's orientation and spacing for the layout; true if the orientation changed. */
  private applyLayout() {
    if (!this.chart) return false
    const orientation = this.orientation()
    // Styles key off this: names get fewer lines in a horizontal tree.
    this.cont.dataset.orientation = orientation
    // family-chart swaps the spacings for a horizontal tree, so these stay in screen axes.
    const [x, y] = SPACING[orientation][this.layout.compact ? 'compact' : 'full']
    if (orientation === 'vertical') this.chart.setOrientationVertical()
    else this.chart.setOrientationHorizontal()
    this.chart.setCardXSpacing(x).setCardYSpacing(y)
    const changed = orientation !== this.drawn
    this.drawn = orientation
    return changed
  }

  /** Forget the current chart (its DOM was replaced, e.g. by the empty-tree screen). */
  reset() {
    this.chart = null
    this.drawn = null
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
        .setSingleParentEmptyCard(false)
        .setShowSiblingsOfMain(true)
        .setSortChildrenFunction((a, b) => byBirth(a.data.person, b.data.person))
      this.applyLayout()
      this.chart.setCardHtml()
        .setCardInnerHtmlCreator(d => {
          const p = d.data.data.person
          const name = displayName(p)
          const sub = allNames(p).filter(n => n !== name).join(' · ')
          const years = lifespan(p)
          const label = [name, genderWord(p), sub, years].filter(Boolean).join(', ')
          const main = p.id === this.mainId
          return `<div class="ft-card ft-${p.gender || 'U'}" data-id="${escapeHtml(p.id)}" tabindex="${main ? 0 : -1}" role="button"${main ? ' aria-current="true"' : ''} aria-label="${escapeHtml(label)}" aria-describedby="${TREE_HINT_ID}">
            <div class="ft-name">${escapeHtml(name)}</div>
            ${sub ? `<div class="ft-sub">${escapeHtml(sub)}</div>` : ''}
            ${years ? `<div class="ft-years">${escapeHtml(years)}</div>` : ''}
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
    // The pane may have changed shape while hidden.
    this.applyLayout()
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

  /** Moves the tree by screen pixels, at once. */
  private panBy(dx: number, dy: number) {
    const el = this.zoomTarget()
    if (!el?.__zoomObj) return
    const k = d3.zoomTransform(el).k
    d3.select(el).call(el.__zoomObj.translateBy, dx / k, dy / k)
  }

  zoom(factor: number) {
    const el = this.zoomTarget()
    if (el?.__zoomObj) d3.select(el).transition().duration(this.panMs).call(el.__zoomObj.scaleBy, factor)
  }
}
