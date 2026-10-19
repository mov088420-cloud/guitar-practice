import { h, pressed } from './dom.ts';
import type { PracticeHost, PracticeSnapshot } from './practicePanel.ts';

export function parseExportTime(value: string): number {
  if (!/^\d+(?::[0-5]?\d)?(?:\.\d+)?$/.test(value.trim())) return NaN;
  const parts = value.trim().split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}
const time = (v: number) => { const ms = Math.round(v * 1000); return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`; };
export class PracticeExport {
  readonly el = h('details', { class: 'gp-export gp-disclosure' });
  active = false;
  a = 0; b = 0;
  private song: object | null = null;
  private busy = false;
  private message = '';
  private start = h('input', { type: 'text', inputMode: 'decimal', 'aria-label': '書き出し開始', placeholder: '0:00.000' });
  private end = h('input', { type: 'text', inputMode: 'decimal', 'aria-label': '書き出し終了', placeholder: '0:00.000' });
  private format = h('select', { 'aria-label': '書き出し形式' }, h('option', { value: 'mp3' }, 'MP3'), h('option', { value: 'wav' }, 'WAV'));
  private info = h('p', { class: 'muted small', role: 'status' });
  private drag = h('button', { type: 'button', class: 'btn' }, '波形で範囲を選ぶ');
  private save = h('button', { type: 'button', class: 'btn primary' }, '書き出す');
  constructor(private host: PracticeHost, private refresh: () => void) {
    const button = (text: string, fn: () => void) => { const el = h('button', { type: 'button', class: 'btn' }, text); el.onclick = fn; return el; };
    this.el.append(h('summary', {}, '音声を書き出す'), h('div', { class: 'gp-detail-body' },
      h('div', { class: 'gp-export-fields' }, h('label', {}, '形式', this.format), h('label', {}, '開始', this.start), h('label', {}, '終了', this.end)),
      h('div', { class: 'gp-row' }, this.drag, button('曲全体', () => this.range(0, host.snapshot().seconds)), button('ループ範囲を使う', () => {
        const { a, b } = host.snapshot().loop;
        if (b > a) this.range(a, b); else this.info.textContent = '先にループ範囲を選んでください。';
      }), this.save), h('p', { class: 'muted small' }, '時刻は「1:30.5」または秒数で入力。現在のミックス・BPM・移調を反映（メトロノームは含みません）。'), this.info));
    this.drag.onclick = () => { this.active = !this.active; refresh(); };
    this.el.ontoggle = () => { if (!this.el.open) { this.active = false; refresh(); } };
    this.start.oninput = this.end.oninput = () => {
      this.message = '';
      const a = parseExportTime(this.start.value), b = parseExportTime(this.end.value);
      if (this.valid(a, b)) { this.a = a; this.b = b; }
      this.render(host.snapshot()); refresh();
    };
    this.save.onclick = async () => {
      const a = parseExportTime(this.start.value), b = parseExportTime(this.end.value);
      if (!this.valid(a, b) || this.busy) return;
      this.message = ''; this.busy = true; this.render(host.snapshot());
      try { await host.exportAudio(this.format.value as 'wav' | 'mp3', a, b); }
      catch (e) { this.message = `書き出しに失敗しました: ${(e as Error).message}`; }
      finally { this.busy = false; this.save.disabled = false; this.save.textContent = '書き出す'; }
    };
  }
  private valid(a: number, b: number) { return Number.isFinite(a + b) && a >= 0 && b > a && b <= this.host.snapshot().seconds + .0005; }
  range(a: number, b: number) {
    this.message = '';
    const seconds = this.host.snapshot().seconds;
    this.a = Math.max(0, Math.min(a, b, seconds)); this.b = Math.max(this.a, Math.min(Math.max(a, b), seconds));
    this.start.value = time(this.a); this.end.value = time(this.b); this.refresh();
  }
  snapshot(s: PracticeSnapshot): PracticeSnapshot { return this.active ? { ...s, loop: { on: true, a: this.a, b: this.b } } : s; }
  render(s: PracticeSnapshot) {
    if (s.song !== this.song) {
      this.message = ''; this.song = s.song; this.active = false; this.a = 0; this.b = s.seconds;
      this.start.value = time(0); this.end.value = time(s.seconds);
    }
    const valid = this.valid(parseExportTime(this.start.value), parseExportTime(this.end.value));
    this.save.disabled = this.busy || !valid || !s.song;
    this.save.textContent = this.busy ? '書き出し中…' : '書き出す';
    pressed(this.drag, this.active);
    this.drag.textContent = this.active ? '範囲選択中（クリックで終了）' : '波形で範囲を選ぶ';
    this.info.textContent = this.message || (valid ? `選択 ${time(this.b - this.a)} ／ 書き出し後 約${time((this.b - this.a) / s.tempo)}` : '開始・終了を曲の範囲内で入力してください（終了は開始より後）。');
  }
}
