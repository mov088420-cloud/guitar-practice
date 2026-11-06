/** Per-stem offset, in semitones, relative to the song-wide key. */
export const MAX_STEM_PITCH = 24;
export function boundedStemPitch(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-MAX_STEM_PITCH, Math.min(MAX_STEM_PITCH, Math.round(value))) : 0;
}
