import { h, fmtTime, pressed } from './dom.ts';
import { STEM_LABELS } from '../practice.ts';
import type { PracticeHost, PracticeSnapshot } from './practicePanel.ts';

/** The existing Deck's peak buffers, rendered as a shared DAW-style time axis. */
export class PracticeTimeline {
  readonly el = h('div', { class: 'gp-arrangement' });
  private rows = h('div', { class: 'gp-track-rows' });
  private ruler = h('canvas', { class: 'gp-ruler', 'aria-label': '時間目盛り。ドラッグでループ範囲を選択' });
  private cycle = h('div', { class: 'gp-cycle' });
  private playhead = h('div', { class: 'gp-playhead' });
  private scroll = h('input', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': '波形の表示位置' });
  private controls: { el: HTMLElement; canvas: HTMLCanvasElement; vol: HTMLInputElement; mute: HTMLButtonElement; solo: HTMLButtonElement; peaks: Float32Array }[] = [];
  private song: object | null = null;
  private start = 0;
  private span = 1;
  private dirty = true;
  private beatMap: number[] | null = null;
  private drag: { x: number; time: number; edge?: 'a' | 'b'; a: number; b: number; moved: boolean } | null = null;
  private draft: { a: number; b: number } | null = null;
  constructor(private host: PracticeHost) {
    const make = (label: string, fn: () => void) => { const b = h('button', { type: 'button', class: 'btn' }, label); b.onclick = fn; return b; };
    const fit = () => { this.start = 0; this.span = this.host.snapshot().seconds; this.dirty = true; this.render(this.host.snapshot()); };
    const zoom = (scale: number) => {
      const s = this.host.snapshot();
      const center = s.position >= this.start && s.position <= this.start + this.span ? s.position : this.start + this.span / 2;
      this.span = Math.min(s.seconds, Math.max(Math.min(2, s.seconds), this.span * scale));
      this.start = Math.max(0, Math.min(s.seconds - this.span, center - this.span / 2));
      this.dirty = true; this.render(s);
    };
    this.scroll.oninput = () => { const s = this.host.snapshot(); this.start = Number(this.scroll.value) / 1000 * Math.max(0, s.seconds - this.span); this.dirty = true; this.render(s); };
    const toolbar = h('div', { class: 'gp-timeline-toolbar' }, h('span', { class: 'muted' }, 'クリックで移動 · ドラッグでループ'), make('縮小 −', () => zoom(2)), make('拡大 ＋', () => zoom(.5)), make('全体', fit));
    const area = h('div', { class: 'gp-track-area' }, h('div', { class: 'gp-ruler-row' }, h('span', {}, 'TRACKS'), this.ruler), this.rows, this.cycle, this.playhead);
    this.el.append(toolbar, area, this.scroll);
    this.bindPointer(this.ruler);
    new ResizeObserver(() => { this.dirty = true; this.render(this.host.snapshot()); }).observe(this.el);
    new MutationObserver(() => { this.dirty = true; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  private bindPointer(el: HTMLElement) {
    const time = (e: PointerEvent) => this.start + Math.max(0, Math.min(1, (e.clientX - el.getBoundingClientRect().left) / el.clientWidth)) * this.span;
    el.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const s = this.host.snapshot(), t = time(e), radius = 9 / Math.max(1, el.clientWidth) * this.span;
      const edge = s.loop.b > s.loop.a ? Math.abs(t - s.loop.a) < radius ? 'a' : Math.abs(t - s.loop.b) < radius ? 'b' : undefined : undefined;
      this.drag = { x: e.clientX, time: t, edge, a: s.loop.a, b: s.loop.b, moved: false };
    };
    el.onpointermove = e => {
      if (!this.drag) return;
      const d = this.drag, t = time(e);
      if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
      if (!d.moved) return;
      const a = d.edge === 'b' ? d.a : d.edge === 'a' ? Math.min(t, d.b - .25) : Math.min(d.time, t);
      const b = d.edge === 'a' ? d.b : d.edge === 'b' ? Math.max(t, d.a + .25) : Math.max(d.time, t);
      this.draft = { a, b }; this.render(this.host.snapshot());
    };
    el.onpointerup = e => {
      const d = this.drag, draft = this.draft;
      this.drag = null; this.draft = null;
      if (d?.moved && draft) this.host.region(draft.a, draft.b);
      else if (d) this.host.seek(time(e));
      this.render(this.host.snapshot());
    };
    el.onpointercancel = el.onlostpointercapture = () => { this.drag = null; this.draft = null; this.render(this.host.snapshot()); };
  }
  render(s: PracticeSnapshot) {
    if (!s.song || !document.body.classList.contains('gp-mode')) return;
    if (s.song !== this.song || this.controls.length !== s.lanes.length) {
      this.song = s.song; this.start = 0; this.span = s.seconds || 1; this.dirty = true;
      this.controls = s.lanes.map((l, i) => {
        const label = STEM_LABELS[l.name.toLowerCase()] ?? l.name;
        const mute = h('button', { type: 'button', class: 'btn gp-ms', 'aria-label': `${label}をミュート`, title: 'ミュート' }, 'M');
        const solo = h('button', { type: 'button', class: 'btn gp-ms', 'aria-label': `${label}をソロ`, title: 'ソロ' }, 'S');
        mute.onclick = () => this.host.lane(i, { mute: !this.host.snapshot().lanes[i].mute });
        solo.onclick = () => this.host.lane(i, { solo: !this.host.snapshot().lanes[i].solo });
        const vol = h('input', { type: 'range', min: '0', max: '1.5', step: '.01', 'aria-label': `${label}の音量` });
        vol.oninput = () => this.host.lane(i, { vol: Number(vol.value) });
        const canvas = h('canvas', { class: 'gp-track-wave', 'aria-label': `${label}の波形` });
        this.bindPointer(canvas);
        const el = h('div', { class: 'gp-lane', 'data-stem': l.name, style: `--track-color:${l.colour}` }, h('div', { class: 'gp-track-header' }, h('strong', {}, label), h('div', { class: 'gp-track-mix' }, mute, solo, vol)), canvas);
        return { el, canvas, vol, mute, solo, peaks: l.peaks };
      });
      const order = ['guitar', 'drums', 'bass', 'vocals', 'piano', 'other'];
      this.rows.replaceChildren(...this.controls.map((c, i) => ({ c, rank: order.indexOf(s.lanes[i].name.toLowerCase()) })).sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank)).map(({ c }) => c.el));
    }
    if (this.beatMap !== s.beats) { this.beatMap = s.beats; this.dirty = true; }
    const soloed = s.lanes.some(l => l.solo);
    this.controls.forEach((c, i) => {
      const l = s.lanes[i];
      c.vol.value = String(l.vol); pressed(c.mute, l.mute); pressed(c.solo, l.solo);
      c.el.classList.toggle('silent', soloed ? !l.solo : l.mute);
      if (c.peaks !== l.peaks) { c.peaks = l.peaks; this.dirty = true; }
    });
    this.scroll.hidden = this.span >= s.seconds;
    this.scroll.value = String(s.seconds > this.span ? this.start / (s.seconds - this.span) * 1000 : 0);
    const rect = this.ruler.getBoundingClientRect();
    if (!rect.width) return;
    const offset = this.ruler.offsetLeft;
    const x = (t: number) => (t - this.start) / this.span * rect.width;
    const loop = this.draft ?? s.loop;
    const left = Math.max(0, x(loop.a)), right = Math.min(rect.width, x(loop.b));
    this.cycle.hidden = loop.b <= loop.a || right <= left;
    this.cycle.style.left = `${offset + left}px`; this.cycle.style.width = `${Math.max(0, right - left)}px`;
    this.cycle.classList.toggle('enabled', !!this.draft || s.loop.on);
    this.playhead.hidden = s.position < this.start || s.position > this.start + this.span;
    this.playhead.style.left = `${offset + x(s.position)}px`;
    if (!this.dirty) return;
    this.dirty = false;
    const paint = (canvas: HTMLCanvasElement) => {
      const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, hgt = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      const g = canvas.getContext('2d')!; g.scale(dpr, dpr); return { g, w, hgt };
    };
    const { g, w, hgt } = paint(this.ruler);
    const css = getComputedStyle(this.el);
    g.fillStyle = css.getPropertyValue('--muted'); g.font = '11px system-ui';
    const tick = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(t => t / this.span * w > 65) ?? 600;
    for (let t = Math.ceil(this.start / tick) * tick; t < this.start + this.span; t += tick) { const at = x(t); g.fillText(fmtTime(t), at + 4, 18); g.fillRect(at, hgt - 8, 1, 8); }
    const maxPeak = Math.max(.001, ...this.controls.map(c => c.peaks.reduce((a, b) => Math.max(a, b), 0)));
    this.controls.forEach((c, index) => {
      const { g, w, hgt } = paint(c.canvas), peaks = c.peaks;
      g.fillStyle = s.lanes[index].colour;
      g.globalAlpha = .12; g.fillRect(0, 3, w, hgt - 6); g.globalAlpha = .9;
      for (let px = 0; px < w; px++) {
        const a = Math.floor((this.start + px / w * this.span) / s.seconds * peaks.length);
        const b = Math.min(peaks.length, Math.max(a + 1, Math.ceil((this.start + (px + 1) / w * this.span) / s.seconds * peaks.length)));
        let peak = 0; for (let j = Math.max(0, a); j < b; j++) peak = Math.max(peak, peaks[j]);
        const height = Math.max(1, peak / maxPeak * (hgt - 16));
        g.fillRect(px, (hgt - height) / 2, 1, height);
      }
      g.globalAlpha = .2; g.fillStyle = css.getPropertyValue('--muted');
      let last = -20;
      s.beats.forEach(t => { const at = x(t); if (at >= 0 && at <= w && at - last > 12) { g.fillRect(at, 0, 1, hgt); last = at; } });
    });
  }
}
