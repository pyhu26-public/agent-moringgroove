// Knowledge-graph renderer (force-graph, canvas). Isolated here so the library can be swapped.
const PALETTE = ['#6ea8ff', '#5fd18a', '#ffb454', '#c792ea', '#ff7a90', '#4dd0e1', '#f2e46b', '#9ccc65'];
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export class GraphView {
  constructor(el, onNode) {
    this.el = el; this.onNode = onNode; this.hover = null; this.sel = null;
    this.g = ForceGraph()(el)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id').nodeRelSize(4)
      .nodeLabel(n => n.title)
      .linkColor(() => 'rgba(140,150,175,.45)').linkWidth(1)
      .linkDirectionalArrowLength(3).linkDirectionalArrowRelPos(1)
      .cooldownTicks(120)
      .onEngineStop(() => this.fit())
      .onNodeHover(n => { this.hover = n; el.style.cursor = n ? 'pointer' : 'default'; })
      .onNodeClick(n => { this.sel = n; this.onNode(n); this.g.centerAt(n.x, n.y, 400); })
      .nodeCanvasObject((n, ctx, scale) => this.paint(n, ctx, scale))
      .nodePointerAreaPaint((n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, this.r(n) + 2, 0, 7); ctx.fill(); });
    this.g.d3Force('link').distance(70);
    this.g.d3Force('charge').strength(-160);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(el);
  }
  r(n) { return 3 + Math.min(8, Math.sqrt(n.degree || 0) * 2); }
  paint(n, ctx, scale) {
    const r = this.r(n), c = PALETTE[hash(n.group) % PALETTE.length];
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fillStyle = c; ctx.fill();
    if (n === this.sel || n === this.hover) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    if (scale > 1.4 || n === this.hover || n === this.sel || n.degree > 3) {
      const fs = 11 / Math.max(scale, 0.8); ctx.font = `${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = getComputedStyle(document.body).color; ctx.fillText(n.title.slice(0, 28), n.x, n.y + r + 2);
    }
  }
  resize() { this.g.width(this.el.clientWidth).height(this.el.clientHeight); }
  set(data) {
    this.sel = null;
    this.g.graphData({ nodes: data.nodes.map(n => ({ ...n })), links: data.links.map(l => ({ ...l })) });
    this._fit = true; // fit once the layout has settled (onEngineStop)
  }
  fit() {
    if (!this._fit) return; this._fit = false;
    this.g.zoomToFit(300, 70);
    setTimeout(() => { const z = this.g.zoom(); if (z > 2.5) this.g.zoom(2.5, 200); }, 350);
  }
  // refresh data in place (after an edit): keep existing node positions, no re-fit
  update(data) {
    const old = new Map(this.g.graphData().nodes.map(n => [n.id, n]));
    const nodes = data.nodes.map(n => { const o = old.get(n.id); return o ? { ...n, x: o.x, y: o.y, vx: o.vx, vy: o.vy } : { ...n }; });
    this.g.graphData({ nodes, links: data.links.map(l => ({ ...l })) });
    this.sel = nodes.find(n => n.id === this.sel?.id) || null;
  }
  select(id) { const n = this.g.graphData().nodes.find(x => x.id === id); if (n) { this.sel = n; this.g.centerAt(n.x, n.y, 400); } }
  redraw() { this.g.refresh?.(); }
  clear() { this.g.graphData({ nodes: [], links: [] }); }
}
