import { PracticeTimeline } from './practiceTimeline.ts';
import type { BeatMode } from '../analysis/beatGrid.ts';
import { canPreset, presetMix, type PracticeLane, type PracticePreset } from '../practice.ts';
import { $, fmtTime, h, pressed } from './dom.ts';

export interface PracticeSnapshot {
  song: object | null; title: string; seconds: number; position: number; playing: boolean;
  sourceBpm: number; tempo: number; volume: number; pitch: number; lanes: (PracticeLane & { peaks: Float32Array; colour: string })[];
  beatMode: BeatMode; manualBpm: number; manualOffset: number; beatBusy: boolean;
  loop: { on: boolean; a: number; b: number };
  click: boolean; clickVol: number; beats: number[]; downbeat: number; perBar: number;
}
export interface PracticeHost {
  snapshot(): PracticeSnapshot;
  pitch(value: number): void;
  region(a: number, b: number): void;
  beatMode(mode: BeatMode): void;
  manualTempo(bpm: number, offset: number): void;
  reanalyse(): void;
  correctTempo(factor: number): void;
  toggle(): void; seek(seconds: number): void; tempo(value: number): void; volume(value: number): void;
  lane(index: number, patch: Partial<PracticeLane>): void;
  mix(lanes: PracticeLane[]): void;
  loop(action: 'toggle' | 'a' | 'b' | 'clear'): void;
  click(): void; clickVolume(value: number): void; bar(): void;
}
const button = (text: string, action: () => void, cls = '') => {
  const el = h('button', { type: 'button', class: `btn ${cls}` }, text);
  el.onclick = action;
  return el;
};
const slider = (name: string, min: number, max: number, step: number, action: (value: number) => void) => {
  const el = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': name });
  el.oninput = () => action(Number(el.value));
  return el;
};

/** A second view of Deck, with no separate audio engine or song state. */
export class PracticePanel {
  private title = h('h1');
  private time = h('output');
  private beatInfo = h('span', { class: 'muted' });
  private beats = h('div', { class: 'gp-beats', 'aria-label': '拍の位置' });
  private loopSummary = h('summary', {}, '区間リピート');
  private loopInfo = h('span', { class: 'muted' });
  private status = h('p', { class: 'gp-status muted', role: 'status' });
  private timeline: PracticeTimeline;
  private playbackBpm = h('input', { type: 'number', step: '.1', 'aria-label': '再生BPM' });
  private bpmReference = h('small', { class: 'muted' });
  private bpmDown: HTMLButtonElement;
  private bpmUp: HTMLButtonElement;
  private pitchDown: HTMLButtonElement;
  private pitchUp: HTMLButtonElement;
  private pitchInput = h('input', { type: 'number', min: '-12', max: '12', step: '1', 'aria-label': '移調（半音）' });
  private beatModeInput = h('select', { 'aria-label': 'テンポの設定' }, h('option', { value: 'auto' }, '自動で曲に追従'), h('option', { value: 'manual' }, '手動BPM（解析しない）'));
  private welcomeMode = h('select', { 'aria-label': '取り込み時のテンポ解析' }, h('option', { value: 'auto' }, '曲のテンポを自動解析'), h('option', { value: 'manual' }, '解析しない（手動BPM）'));
  private bpmInput = h('input', { type: 'number', min: '30', max: '300', step: '.1', 'aria-label': '手動BPM' });
  private offsetInput = h('input', { type: 'number', min: '0', step: '.01', 'aria-label': '拍の開始位置（秒）' });
  private manualFields = h('div', { class: 'gp-manual-fields' });
  private reanalyse: HTMLButtonElement;
  private autoFields = h('div', { class: 'gp-auto-fields' });

  private song: object | null = null;
  private beforePreset: PracticeLane[] | null = null;
  private play: HTMLButtonElement;
  private seek: HTMLInputElement;
  private tempo: HTMLInputElement;
  private tempoOut = h('output');
  private volume: HTMLInputElement;
  private libraryToggle: HTMLButtonElement | undefined;
  private click: HTMLButtonElement;
  private clickVol: HTMLInputElement;
  private bar: HTMLButtonElement;
  private loop: HTMLButtonElement;
  private restore: HTMLButtonElement;
  private presets: { preset: PracticePreset; el: HTMLButtonElement }[];

  constructor(private host: PracticeHost) {
    this.play = button('▶ 再生', () => host.toggle(), 'primary gp-play');
    this.seek = slider('曲の再生位置', 0, 1, 0.01, (v) => host.seek(v));
    this.tempo = slider('再生速度', 0.5, 1.5, 0.01, (v) => host.tempo(v));
    this.volume = slider('マスター音量', 0, 1, 0.01, (v) => host.volume(v));
    this.click = button('メトロノーム', () => host.click(), 'toggle');
    this.clickVol = slider('クリック音量', 0.05, 1, 0.05, (v) => host.clickVolume(v));
    this.bar = button('強拍を1拍後ろへ', () => host.bar());
    this.loop = button('⟳ ループ', () => host.loop('toggle'), 'toggle');
    this.presets = ([['no-guitar', 'ギターなし'], ['rhythm', 'リズムだけ'], ['all', '全パート']] as const).map(([preset, text]) => ({ preset, el: button(text, () => this.applyPreset(preset)) }));
    this.restore = button('適用前に戻す', () => {
      if (!this.beforePreset) return;
      const before = this.beforePreset;
      this.beforePreset = null;
      host.mix(before);
      this.status.textContent = '元の音量に戻しました。';
      this.render();
    });
    this.timeline = new PracticeTimeline(host);
    const changeBpm = (value: number) => {
      const s = host.snapshot();
      if (s.sourceBpm > 0 && Number.isFinite(value) && value > 0) host.tempo(Math.max(.5, Math.min(1.5, value / s.sourceBpm)));
      const next = host.snapshot();
      this.playbackBpm.value = next.sourceBpm > 0 ? (next.sourceBpm * next.tempo).toFixed(1) : '';
      this.render();
    };
    this.playbackBpm.onchange = () => changeBpm(this.playbackBpm.valueAsNumber);
    this.bpmDown = button('−', () => changeBpm(host.snapshot().sourceBpm * host.snapshot().tempo - 1));
    this.bpmUp = button('＋', () => changeBpm(host.snapshot().sourceBpm * host.snapshot().tempo + 1));
    this.bpmDown.setAttribute('aria-label', '再生BPMを1下げる');
    this.bpmUp.setAttribute('aria-label', '再生BPMを1上げる');
    this.pitchDown = button('−', () => host.pitch(host.snapshot().pitch - 1));
    this.pitchUp = button('＋', () => host.pitch(host.snapshot().pitch + 1));
    this.pitchDown.setAttribute('aria-label', 'キーを半音下げる');
    this.pitchUp.setAttribute('aria-label', 'キーを半音上げる');
    this.pitchInput.onchange = () => {
      host.pitch(Number(this.pitchInput.value) || 0);
      this.pitchInput.value = String(host.snapshot().pitch);
      this.render();
    };
    this.beatModeInput.onchange = () => host.beatMode(this.beatModeInput.value as BeatMode);
    this.welcomeMode.onchange = () => host.beatMode(this.welcomeMode.value as BeatMode);
    const setManual = () => { host.manualTempo(Number(this.bpmInput.value), Number(this.offsetInput.value)); this.render(); };
    this.bpmInput.onchange = this.offsetInput.onchange = setManual;
    this.reanalyse = button('拍を再解析', () => host.reanalyse());
    this.autoFields.append(this.reanalyse, button('BPM ÷2', () => host.correctTempo(.5)), button('BPM ×2', () => host.correctTempo(2)));
    this.manualFields.append(h('label', {}, 'BPM', this.bpmInput), h('label', {}, '開始（秒）', this.offsetInput), button('ここを1拍目', () => host.manualTempo(host.snapshot().manualBpm, host.snapshot().position)));
    $('welcome').querySelector('.start-row')!.after(h('label', { class: 'gp-import-tempo' }, 'テンポ', this.welcomeMode));
    const el = h('section', { class: 'gp-panel', 'aria-label': 'ギター練習' },
      h('div', { class: 'gp-console' }, h('div', { class: 'gp-heading' }, this.title, this.time),
      h('div', { class: 'gp-transport' }, this.play, button('−5秒', () => host.seek(Math.max(0, host.snapshot().position - 5))), button('＋5秒', () => host.seek(Math.min(host.snapshot().seconds, host.snapshot().position + 5))), this.loop,
        h('label', { class: 'gp-speed-control' }, h('span', {}, '速度 ', this.tempoOut), this.tempo)),
      h('div', { class: 'gp-musical-controls' },
        h('div', { class: 'gp-musical-control', role: 'group', 'aria-label': '曲のテンポ' }, h('strong', {}, '再生BPM'), this.bpmDown, this.playbackBpm, this.bpmUp, button('原速', () => host.tempo(1)), this.bpmReference),
        h('div', { class: 'gp-musical-control', role: 'group', 'aria-label': '曲の移調' }, h('strong', {}, 'キー'), this.pitchDown, this.pitchInput, this.pitchUp, h('small', { class: 'muted' }, '半音'), button('原曲キー', () => host.pitch(0)))),
      h('div', { class: 'gp-command-row' }, h('div', { class: 'gp-presets', role: 'group', 'aria-label': '伴奏の選択' }, ...this.presets.map((p) => p.el)), this.click, this.beatInfo)),
      this.timeline.el,
      h('div', { class: 'gp-position' }, this.seek),
      h('div', { class: 'gp-tempo-settings' }, h('label', {}, 'テンポ', this.beatModeInput), this.manualFields, this.autoFields),
      h('details', { class: 'gp-loop gp-disclosure' }, this.loopSummary, h('div', { class: 'gp-detail-body' }, h('div', { class: 'gp-row' }, button('Aを設定', () => host.loop('a')), button('Bを設定', () => host.loop('b')), button('解除', () => host.loop('clear'))), this.loopInfo)),
      h('details', { class: 'gp-mixer gp-disclosure' }, h('summary', {}, '音量・メトロノームの調整'), h('div', { class: 'gp-detail-body' },
        h('div', { class: 'gp-tools' }, h('label', {}, '全体の音量', this.volume), h('label', {}, 'メトロノームの音量', this.clickVol)),
        h('div', { class: 'gp-row' }, this.beats, this.bar, this.restore))),
      this.status);
    $('deck').prepend(el);
    const mode = button('詳細モード', () => setMode(!document.body.classList.contains('gp-mode')));
    mode.id = 'practiceMode';
    const setMode = (practice: boolean) => {
      document.body.classList.toggle('gp-mode', practice);
      mode.textContent = practice ? '詳細モード' : '練習モード';
      mode.setAttribute('aria-label', practice ? '詳細モードへ切り替え' : '練習モードへ切り替え');
      try { localStorage.setItem('steminize.guitarPractice', practice ? '1' : '0'); } catch { /* private mode */ }
      window.dispatchEvent(new Event('resize'));
      this.render();
    };
    const actions = document.querySelector('.top-actions')!;
    const menu = h('details', { class: 'gp-menu' }, h('summary', {}, 'その他'));
    const menuBody = h('div', { class: 'gp-menu-body' }, mode, ...Array.from(actions.children));
    menu.append(menuBody);
    actions.append(menu);
    const side = document.querySelector<HTMLElement>('.side')!;
    side.id = 'practiceLibrary';
    this.libraryToggle = button('曲を選ぶ', () => this.showLibrary(!document.body.classList.contains('gp-library-open')));
    this.libraryToggle.id = 'practiceLibraryToggle';
    this.libraryToggle.setAttribute('aria-controls', side.id);
    this.libraryToggle.setAttribute('aria-expanded', 'false');
    actions.prepend(this.libraryToggle);
    for (const id of ['fileInput', 'multiFiles', 'multiFolder', 'libImport']) {
      $(id).addEventListener('change', () => this.showLibrary(true));
    }
    $('drop').addEventListener('drop', () => this.showLibrary(true));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { menu.open = false; this.showLibrary(false); }
    });
    mode.addEventListener('click', () => { menu.open = false; });
    let practice = true;
    try { practice = localStorage.getItem('steminize.guitarPractice') !== '0'; } catch { /* private mode */ }
    setMode(practice);
  }

  private showLibrary(open: boolean) {
    if (!open && document.body.classList.contains('gp-mode') && document.querySelector('.side')?.contains(document.activeElement)) this.libraryToggle?.focus();
    document.body.classList.toggle('gp-library-open', open);
    this.libraryToggle?.setAttribute('aria-expanded', String(open));
    if (this.libraryToggle) this.libraryToggle.textContent = open ? '曲一覧を閉じる' : '曲を選ぶ';
    window.dispatchEvent(new Event('resize'));
  }

  private applyPreset(preset: PracticePreset) {
    const s = this.host.snapshot();
    if (!canPreset(s.lanes, preset)) return;
    this.beforePreset ??= s.lanes.map((l) => ({ ...l }));
    this.host.mix(presetMix(s.lanes, preset));
    this.status.textContent = '伴奏を変更しました。';
    this.render();
  }

  render() {
    const s = this.host.snapshot();
    if (s.song !== this.song) {
      this.song = s.song;
      this.beforePreset = null;

      this.status.textContent = '';
      this.showLibrary(false);
    }
    this.welcomeMode.value = s.beatMode;
    this.beatModeInput.value = s.beatMode;
    this.manualFields.hidden = s.beatMode !== 'manual';
    this.autoFields.hidden = s.beatMode !== 'auto';
    this.reanalyse.disabled = s.beatBusy;
    this.reanalyse.textContent = s.beatBusy ? '解析中…' : '拍を再解析';
    if (document.activeElement !== this.bpmInput) this.bpmInput.value = String(s.manualBpm);
    if (document.activeElement !== this.offsetInput) this.offsetInput.value = String(Math.round(s.manualOffset * 100) / 100);
    if (!s.song) return;
    this.title.textContent = s.title;
    this.time.textContent = `${fmtTime(s.position)} / ${fmtTime(s.seconds)}`;
    this.play.textContent = s.playing ? 'Ⅱ 一時停止' : '▶ 再生';
    this.seek.max = String(s.seconds);
    this.seek.value = String(s.position);
    this.tempo.value = String(s.tempo);
    this.tempoOut.textContent = `${Math.round(s.tempo * 100)}%`;
    const knownBpm = Number.isFinite(s.sourceBpm) && s.sourceBpm > 0;
    this.playbackBpm.disabled = !knownBpm;
    this.bpmDown.disabled = !knownBpm || s.tempo <= .5;
    this.bpmUp.disabled = !knownBpm || s.tempo >= 1.5;
    this.playbackBpm.min = knownBpm ? String(s.sourceBpm * .5) : '0';
    this.playbackBpm.max = knownBpm ? String(s.sourceBpm * 1.5) : '0';
    if (document.activeElement !== this.playbackBpm) this.playbackBpm.value = knownBpm ? (s.sourceBpm * s.tempo).toFixed(1) : '';
    this.playbackBpm.title = knownBpm ? '音程を保って曲の速さを変更（原速の50〜150%）' : 'テンポ解析、または下の手動BPM設定が必要です';
    this.bpmReference.textContent = knownBpm ? `${s.beatMode === 'manual' ? '基準' : '原曲'} ${s.sourceBpm.toFixed(1)}` : '解析待ち／手動で設定';
    this.pitchDown.disabled = s.pitch <= -12;
    this.pitchUp.disabled = s.pitch >= 12;
    if (document.activeElement !== this.pitchInput) this.pitchInput.value = String(s.pitch);
    this.offsetInput.max = String(s.seconds);
    this.timeline.render(s);
    this.volume.value = String(s.volume);
    this.clickVol.value = String(s.clickVol);
    this.click.disabled = this.clickVol.disabled = this.bar.disabled = !s.beats.length;
    pressed(this.click, s.click);
    pressed(this.loop, s.loop.on);
    this.loopSummary.textContent = s.loop.on ? '区間リピート · ON' : '区間リピート';
    this.loopInfo.textContent = s.loop.b > s.loop.a ? `${fmtTime(s.loop.a)} → ${fmtTime(s.loop.b)}${s.loop.on ? ' ・繰り返し中' : ' ・停止中'}` : 'A・Bを指定してください';
    this.restore.disabled = !this.beforePreset;
    this.click.title = s.beatMode === 'manual' ? '手動BPMで再生' : s.beats.length ? '検出した拍に合わせて再生' : '拍データなし。再解析できます';
    for (const p of this.presets) {
      p.el.disabled = !canPreset(s.lanes, p.preset);
      const target = presetMix(s.lanes, p.preset);
      pressed(p.el, !p.el.disabled && target.every((l, i) => l.mute === s.lanes[i].mute && l.solo === s.lanes[i].solo));
      p.el.title = p.el.disabled ? '必要な独立ステムがありません。6ステム分離、またはパート名を付けたマルチトラックを使ってください。' : '';
    }
    // Binary search in the same measured beat map used by the AudioWorklet.
    let lo = 0, hi = s.beats.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s.beats[m] <= s.position) lo = m + 1; else hi = m; }
    const index = lo - 1;
    const interval = index >= 0 && index + 1 < s.beats.length ? s.beats[index + 1] - s.beats[index] : 0;
    this.beatInfo.textContent = !s.beats.length ? '拍データなし' : interval > 0 ? `${Math.round(60 / interval * s.tempo)} BPM · ${s.perBar}拍子` : s.beatMode === 'manual' ? `${Math.round(s.manualBpm * s.tempo)} BPM · 手動` : '検出した拍に同期';
    if (this.beats.children.length !== s.perBar) this.beats.replaceChildren(...Array.from({ length: s.perBar }, (_, i) => h('span', {}, String(i + 1))));
    Array.from(this.beats.children).forEach((b, i) => b.classList.toggle('active', index >= 0 && s.position <= (s.beats.at(-1) ?? 0) && ((index - s.downbeat) % s.perBar + s.perBar) % s.perBar === i));
  }
}
