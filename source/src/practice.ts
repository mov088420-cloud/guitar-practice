// Pure preset policy: never infer a missing guitar from the four-stem "other" track.
export type PracticePreset = 'no-guitar' | 'rhythm' | 'all';
export interface PracticeLane { name: string; vol: number; mute: boolean; solo: boolean }
export function canPreset(lanes: readonly PracticeLane[], preset: PracticePreset): boolean {
  const names = lanes.map((l) => l.name.toLowerCase());
  return preset === 'all' || (preset === 'no-guitar' ? names.includes('guitar') : names.includes('drums') && names.includes('bass'));
}
export function presetMix(lanes: readonly PracticeLane[], preset: PracticePreset): PracticeLane[] {
  if (!canPreset(lanes, preset)) return lanes.map((l) => ({ ...l }));
  return lanes.map((l) => ({ ...l, solo: false, mute: preset === 'no-guitar' ? l.name.toLowerCase() === 'guitar' : preset === 'rhythm' ? !['drums', 'bass'].includes(l.name.toLowerCase()) : false }));
}
export const STEM_LABELS: Record<string, string> = { guitar: 'ギター', drums: 'ドラム', bass: 'ベース', vocals: 'ボーカル', piano: 'ピアノ', other: 'その他' };
