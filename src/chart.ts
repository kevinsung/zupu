import * as f3 from 'family-chart'
import 'family-chart/styles/family-chart.css'
import { type People, allNames, displayName, lifespan } from './model'
import { escapeHtml } from './dom'

/** Wraps family-chart so the rest of the app only deals in People and ids. */
export class TreeChart {
  private chart: f3.Chart | null = null

  constructor(private cont: HTMLElement, private onSelect: (id: string) => void) {}

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
        .setCardXSpacing(190)
        .setCardYSpacing(140)
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
      this.chart.updateTree({ initial: false, tree_position: 'main_to_middle', transition_time: 0 })
      return
    }
    this.chart.updateData(data)
    this.chart.updateMainId(mainId)
    this.chart.updateTree({ tree_position: recenter ? 'main_to_middle' : 'inherit' })
  }
}
