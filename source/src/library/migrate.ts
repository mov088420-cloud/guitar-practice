import type { LibraryBackend } from './backend.ts';
const digest = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)).join(',');
/** Copy and verify EVERY song before removing any browser copy. No audio re-encoding. */
export async function migrateLibrary(source: LibraryBackend, target: LibraryBackend, progress: (message: string) => void = () => {}) {
  const songs = await source.list();
  const existing = new Set((await target.list()).map(s => s.id));
  for (let i = 0; i < songs.length; i++) {
    const { id } = songs[i];
    progress(`保存フォルダへ移行中 ${i + 1}/${songs.length}（照合してから旧データを削除）`);
    const metaBytes = await source.readFile(id, 'meta.json');
    const meta = new TextDecoder().decode(metaBytes);
    const expected = (await source.listFiles(id)).filter(n => n !== 'meta.json').sort();
    if (!existing.has(id)) await target.beginSong?.(id);
    else {
      const actual = (await target.listFiles(id)).filter(n => n !== 'meta.json').sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('同じIDの異なる曲があります。旧データは残しています。');
    }
    for (const name of expected) {
      const bytes = await source.readFile(id, name);
      if (!existing.has(id)) await target.writeFile(id, name, bytes);
      if (await digest(bytes) !== await digest(await target.readFile(id, name))) throw new Error('コピーの照合に失敗しました。旧データは残しています。');
    }
    await target.writeMeta(id, meta);
    if (await digest(metaBytes) !== await digest(await target.readFile(id, 'meta.json'))) throw new Error('設定の照合に失敗しました。旧データは残しています。');
  }
  // If another open window saved new settings meanwhile, retain that browser copy.
  let removed = 0;
  for (const { id } of songs) {
    try {
      if (await digest(await source.readFile(id, 'meta.json')) !== await digest(await target.readFile(id, 'meta.json'))) continue;
      await source.deleteSong(id); removed++;
    } catch { /* Verified destination is usable even if browser cleanup fails. */ }
  }
  return { copied: songs.length, removed };
}
