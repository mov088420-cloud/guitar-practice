import { h } from './dom.ts';
import { boundedStemPitch, MAX_STEM_PITCH } from '../player/stemPitch.ts';

/** Shared compact controls for the practice track and detailed mixer. */
export class StemPitchControls {
  readonly el = h('div', { class: 'gp-stem-pitch' });
  private input: HTMLInputElement;
  private minus: HTMLButtonElement;
  private plus: HTMLButtonElement;
  private down: HTMLButtonElement;
  private up: HTMLButtonElement;
  private reset: HTMLButtonElement;
  constructor(label: string, read: () => number, change: (value: number) => void) {
    const button = (text: string, name: string, action: () => void) => {
      const b = h('button', { type: 'button', class: 'btn', 'aria-label': `${label}${name}`, title: `${label}${name}` }, text);
      b.onclick = action; return b;
    };
    const set = (value: number) => { change(boundedStemPitch(value)); this.input.value = String(boundedStemPitch(read())); this.render(read()); };
    this.input = h('input', { type: 'number', min: String(-MAX_STEM_PITCH), max: String(MAX_STEM_PITCH), step: '1', value: '0', 'aria-label': `${label}のキー（半音）`, title: '曲全体のキーに加える半音数' });
    this.input.onchange = () => set(this.input.valueAsNumber);
    this.minus = button('−', 'のキーを半音下げる', () => set(read() - 1));
    this.plus = button('＋', 'のキーを半音上げる', () => set(read() + 1));
    this.down = button('−1 oct', 'を1オクターブ下げる', () => set(read() - 12));
    this.up = button('＋1 oct', 'を1オクターブ上げる', () => set(read() + 12));
    this.reset = button('元に戻す', 'のキーを元に戻す', () => set(0));
    this.el.append(h('div', { class: 'gp-stem-key-row' }, h('span', { class: 'muted' }, 'キー'), this.minus, this.input, this.plus), h('div', { class: 'gp-stem-oct-row' }, this.down, this.up, this.reset));
  }
  render(value: number) {
    const pitch = boundedStemPitch(value);
    if (document.activeElement !== this.input) this.input.value = String(pitch);
    this.minus.disabled = this.down.disabled = pitch <= -MAX_STEM_PITCH;
    this.plus.disabled = this.up.disabled = pitch >= MAX_STEM_PITCH;
    this.reset.disabled = pitch === 0;
    this.el.classList.toggle('shifted', pitch !== 0);
  }
}
