import { connectLocalLibrary, type LocalLibrary } from './library/localBackend.ts';
import { migrateLibrary } from './library/migrate.ts';
// Song library: separated stems kept on the user's own device, so songs reopen without separating
// them again. Two backends implement identical storage (src/library/backend.ts): OPFS in the browser,
// or plain files via Tauri on desktop (Linux needs the latter — see nativeBackend.ts). Both use the
// same layout, so a backup zip from one restores on the other: library/<id>/meta.json + one FLAC file
// per stem/take. Everything below is backend-agnostic; picking and driving one is all that differs.

import { background as encoder } from './encode/client.ts';
import type { Stereo } from './engine/separate.ts';
import { nativeBackend } from './library/nativeBackend.ts';
import { opfsAvailable, opfsBackend } from './library/opfsBackend.ts';
import { isTauri } from './platform.ts';
import type { Settings } from './settings.ts';
import type { KeyResult } from './analysis/key.ts';

export interface Analysis {
  bpm: number;
  beats: number[]; // seconds
  downbeat: number;
  key?: KeyResult;
}

export interface TakeMeta {
  id: string; // display id within its group, e.g. "take-1" — not unique across groups on its own
  scale: number;
  note?: string;
}

/** One recorded source (e.g. "Bass", "Guitar") and every take made for it. `id` is an internal,
 * stable, never-shown key: takes are stored as `<groupId>-<takeId>.flac`, since two groups could
 * otherwise both produce a "take-1" and collide in the same song folder. The group's own display
 * name is just its lane's `label`, saved the same way any other track's rename already is. */
export interface TakeGroupMeta {
  id: string;
  takes: TakeMeta[];
  activeTake?: string;
}

export interface LibMeta {
  id: string;
  title: string;
  seconds: number;
  took?: number;
  created: number;
  settings: Settings;
  kind?: 'separated' | 'multitrack';
  stems: { name: string; scale: number }[];
  bytes: number;
  analysis?: Analysis;
  state?: unknown; // player state (mixer, EQ, loop, practice), owned by the deck
  /** Live-recorded takes (see the Live input drawer), saved as extra files alongside the stems. */
  takeGroups?: TakeGroupMeta[];
}

let local: LocalLibrary | null = null;
export const libraryStorage = { path: '', notice: '', local: false };
const storageReady = (async () => {
  if (isTauri) return;
  const found = await connectLocalLibrary();
  if (!found) return;
  const progress = (message: string) => {
    libraryStorage.notice = message;
    document.dispatchEvent(new Event('guitar-storage-change'));
  };
  try {
    if (opfsAvailable()) {
      const move = () => migrateLibrary(opfsBackend, found, progress);
      const result = navigator.locks ? await navigator.locks.request('guitar-library-migration', move) : await move();
      progress(result.copied ? `${result.copied}曲をフォルダへ移行しました。${result.copied === result.removed ? 'ブラウザ内の旧コピーは削除済みです。' : '削除できなかった旧コピーはブラウザに残しています。'}` : '');
    }
    local = found;
    libraryStorage.local = true; libraryStorage.path = found.path;
  } catch (error) {
    // Until every song is verified, source songs remain playable in browser storage.
    progress(`移行を完了できませんでした。ブラウザ保存を継続します。${(error as Error).message}`);
  }
  document.dispatchEvent(new Event('guitar-storage-change'));
})();
export const libraryAvailable = () => isTauri || !!local || opfsAvailable();
export const openLibraryFolder = async (id?: string) => { await storageReady; if (!local) throw new Error('この環境はブラウザ内保存です'); await local.open(id); };
const backend = async () => { await storageReady; return isTauri ? nativeBackend : local ?? opfsBackend; };

/** Free bytes where songs are stored, or null when unknown. */
export const freeLibrarySpace = async (): Promise<number | null> => (await backend()).freeSpace();

export async function listSongs(): Promise<LibMeta[]> {
  if (!libraryAvailable()) return [];
  const entries = await (await backend()).list();
  return entries.map(({ id, meta }) => ({ ...JSON.parse(meta), id })).sort((a, b) => b.created - a.created);
}

/** Track names become file names in the library, so keep them safe and unique. */
function safeStemNames<T extends { name: string }>(stems: T[]): T[] {
  const seen = new Map<string, number>();
  return stems.map((s) => {
    let name = s.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'track';
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    if (n > 1) name = `${name} (${n})`;
    return { ...s, name };
  });
}

/** Peak-scales and FLAC-encodes stems (via the shared worker), writing each through `write` as it's ready. */
async function encodeAndStore(stems: { name: string; data: Stereo; scale: number }[], write: (name: string, bytes: Uint8Array) => Promise<number>, onProgress?: (done: number, total: number) => void): Promise<number> {
  let total = 0;
  await encoder.run({ type: 'lib-encode', stems }, async (name, bytes) => {
    total += await write(name, bytes);
  }, onProgress);
  return total;
}

export async function saveSong(meta: Omit<LibMeta, 'bytes' | 'stems' | 'id'>, stems: { name: string; data: Stereo }[], onProgress?: (done: number, total: number) => void): Promise<LibMeta> {
  const id = `${new Date(meta.created).toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  const b = await backend();
  // 16-bit storage: scale down any stem that peaks above full scale, and undo it on load.
  const withScale = safeStemNames(stems).map((s) => {
    let peak = 0;
    for (const c of s.data) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
    return { ...s, scale: peak > 0.999 ? 0.999 / peak : 1 };
  });
  await b.beginSong?.(id);
  const full: LibMeta = { ...meta, id, bytes: 0, stems: withScale.map((s) => ({ name: s.name, scale: s.scale })) };
  full.bytes = await encodeAndStore(withScale, (name, bytes) => b.writeFile(id, `${name}.flac`, bytes), onProgress);
  // meta.json last: a folder without it is an incomplete save, and every backend treats it that way
  // when listing, retaining incomplete files for recovery.
  await b.writeMeta(id, JSON.stringify(full));
  return full;
}

export async function writeMeta(meta: LibMeta) {
  await (await backend()).writeMeta(meta.id, JSON.stringify(meta));
}

export async function loadStems(meta: LibMeta): Promise<{ name: string; data: Stereo }[]> {
  const b = await backend();
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const out: { name: string; data: Stereo }[] = [];
  for (const s of meta.stems) {
    const bytes = await b.readFile(meta.id, `${s.name}.flac`);
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const k = 1 / s.scale;
    const ch = (i: number) => {
      const a = buf.getChannelData(Math.min(i, buf.numberOfChannels - 1)).slice();
      if (k !== 1) for (let j = 0; j < a.length; j++) a[j] *= k;
      return a;
    };
    out.push({ name: s.name, data: [ch(0), ch(1)] });
  }
  return out;
}

export async function deleteSong(id: string) {
  await (await backend()).deleteSong(id);
}

/** Adds one take's audio as a new file in an already-saved song's folder, and updates its meta.json (bumping `meta.takeGroups` first is the caller's job, same as the rest of LibMeta). */
export async function addTake(meta: LibMeta, groupId: string, take: { id: string; data: Stereo; note?: string }): Promise<TakeMeta> {
  const b = await backend();
  let peak = 0;
  for (const c of take.data) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const scale = peak > 0.999 ? 0.999 / peak : 1;
  const name = `${groupId}-${take.id}`;
  await encodeAndStore([{ name, data: take.data, scale }], (n, bytes) => b.writeFile(meta.id, `${n}.flac`, bytes));
  await b.writeMeta(meta.id, JSON.stringify(meta));
  return { id: take.id, scale, note: take.note };
}

/** Removes one take's audio file from a song's folder. Caller updates `meta.takeGroups` first. */
export async function removeTake(meta: LibMeta, groupId: string, takeId: string) {
  const b = await backend();
  await b.removeFile(meta.id, `${groupId}-${takeId}.flac`);
  await b.writeMeta(meta.id, JSON.stringify(meta));
}

export async function loadTake(songId: string, groupId: string, take: TakeMeta): Promise<Stereo> {
  const bytes = await (await backend()).readFile(songId, `${groupId}-${take.id}.flac`);
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const k = 1 / take.scale;
  const ch = (i: number) => {
    const a = buf.getChannelData(Math.min(i, buf.numberOfChannels - 1)).slice();
    if (k !== 1) for (let j = 0; j < a.length; j++) a[j] *= k;
    return a;
  };
  return [ch(0), ch(1)];
}

/** Zips the whole library (as stored: FLAC stems + meta.json per song) for backup. */
export async function exportLibrary(onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const b = await backend();
  const songs = await b.list();
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < songs.length; i++) {
    const id = songs[i].id;
    for (const name of await b.listFiles(id)) files[`${id}/${name}`] = await b.readFile(id, name);
    onProgress?.(i + 1, songs.length);
  }
  return encoder.run<Uint8Array>({ type: 'zip', files });
}

/** Restores songs from a backup zip. Songs already in the library (same id) are left alone. */
export async function importLibrary(zip: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<{ imported: number; skipped: number }> {
  const b = await backend();
  const unzipped = await encoder.run<Record<string, Uint8Array>>({ type: 'unzip', zip });
  const bySong = new Map<string, Record<string, Uint8Array>>();
  for (const [path, bytes] of Object.entries(unzipped)) {
    const slash = path.indexOf('/');
    if (slash < 0) continue; // stray file at the zip root: not a song folder
    const [song, fname] = [path.slice(0, slash), path.slice(slash + 1)];
    if (!fname) continue;
    (bySong.get(song) ?? (bySong.set(song, {}), bySong.get(song)!))[fname] = bytes;
  }
  const existing = new Set((await b.list()).map((s) => s.id));
  const entries = [...bySong.entries()];
  let imported = 0;
  let skipped = 0;
  for (let i = 0; i < entries.length; i++) {
    const [song, fileset] = entries[i];
    if (!fileset['meta.json'] || existing.has(song)) {
      skipped++;
    } else {
      await b.beginSong?.(song);
      for (const [fname, bytes] of Object.entries(fileset)) if (fname !== 'meta.json') await b.writeFile(song, fname, bytes);
      // meta.json last: a folder without it is an incomplete save and is ignored.
      await b.writeMeta(song, new TextDecoder().decode(fileset['meta.json']));
      imported++;
    }
    onProgress?.(i + 1, entries.length);
  }
  return { imported, skipped };
}
