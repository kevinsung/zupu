import * as f3 from 'family-chart'
import 'family-chart/styles/family-chart.css'
import * as d3 from 'd3'
import { type People, allNames, displayName, lifespan } from './model'
import { escapeHtml } from './dom'

/** Wraps family-chart so the rest of the app only deals in People and ids. */
export class TreeChart {
  private chart: f3.Chart | null = null

  /** `compact` uses smaller cards and spacing so more of the tree fits on a phone. */
  constructor(private cont: HTMLElement, private onSelect: (id: string) => void, private compact = false) {
    cont.classList.toggle('compact', compact)
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
    if (!this.chart) {
      this.chart = f3.createChart(this.cont, data)
        .setTransitionTime(600)
        .setCardXSpacing(this.compact ? 132 : 190)
        .setCardYSpacing(this.compact ? 110 : 140)
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
          return `<div class="ft-card ft-${p.gender || 'U'}">
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
    this.chart.updateTree({ tree_position: 'inherit' })
    if (recenter) this.center()
  }

  /** The element d3-zoom is attached to, if the chart exists. */
  private zoomTarget(): (Element & { __zoomObj?: d3.ZoomBehavior<Element, unknown> }) | null {
    const svg = this.chart?.svg as (SVGElement & { __zoomObj?: unknown }) | undefined
    if (!svg) return null
    return (svg.__zoomObj ? svg : svg.parentNode) as Element & { __zoomObj?: d3.ZoomBehavior<Element, unknown> }
  }

  /** Pan so the selected person is in the middle, keeping the current zoom level. */
  center(transition = 600) {
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
    if (el?.__zoomObj) d3.select(el).transition().duration(250).call(el.__zoomObj.scaleBy, factor)
  }
}
