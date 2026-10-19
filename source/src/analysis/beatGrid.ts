/** Manual beat clock in source-song seconds; playback speed is applied by the audio engine. */
export type BeatMode = 'auto' | 'manual';
export const boundedBpm = (value: number) => Number.isFinite(value) ? Math.max(30, Math.min(300, value)) : 120;
export function manualBeats(seconds: number, bpm: number, offset = 0): number[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  const start = Number.isFinite(offset) ? Math.max(0, Math.min(seconds, offset)) : 0;
  const step = 60 / boundedBpm(bpm);
  return Array.from({ length: Math.max(0, Math.ceil((seconds - start) / step)) }, (_, i) => start + i * step);
}
export function loadBeatMode(): BeatMode {
  try { return localStorage.getItem('steminize.beatMode') === 'manual' ? 'manual' : 'auto'; } catch { return 'auto'; }
}
export function saveBeatMode(mode: BeatMode) {
  try { localStorage.setItem('steminize.beatMode', mode); } catch { /* storage unavailable */ }
}
