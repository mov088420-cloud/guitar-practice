import type { LibraryBackend } from './backend.ts';
export interface LocalLibrary extends LibraryBackend { path: string; open(id?: string): Promise<void> }
export async function connectLocalLibrary(): Promise<LocalLibrary | null> {
  // A hosted/shared web app never attempts to access the local Mac bridge.
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return null;
  const discover = async () => {
    const res = await fetch('./__guitar_practice_health', { method: 'POST', headers: { 'X-Guitar-Client': '1' }, cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
    const value = await res.json();
    return value.app === 'guitar-practice-pwa' && value.library?.version === 1 ? value.library as { token: string; path: string } : null;
  };
  let config: { token: string; path: string } | null;
  try { config = await discover(); } catch { return null; }
  if (!config) return null;
  let token = config.token;
  async function request(action: string, method = 'POST', id?: string, name?: string, bytes?: Uint8Array | string): Promise<Response> {
    const query = new URLSearchParams(); if (id) query.set('id', id); if (name) query.set('name', name);
    const send = () => fetch(`./__gp/library/${action}?${query}`, { method, cache: 'no-store', headers: { 'X-Guitar-Token': token }, body: bytes as BodyInit | undefined });
    let res = await send();
    if (res.status === 401) { const fresh = await discover(); if (fresh) { token = fresh.token; res = await send(); } }
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `保存フォルダにアクセスできません (${res.status})`); }
    return res;
  }
  return {
    path: config.path,
    list: async () => (await request('list')).json(),
    beginSong: async id => { await request('begin', 'POST', id); },
    writeMeta: async (id, meta) => { await request('meta', 'PUT', id, undefined, meta); },
    writeFile: async (id, name, bytes) => {
      const saved = await (await request('file', 'PUT', id, name, bytes)).json();
      if (saved.bytes !== bytes.byteLength) throw new Error('保存したサイズが一致しません');
      return saved.bytes;
    },
    readFile: async (id, name) => new Uint8Array(await (await request('file', 'POST', id, name)).arrayBuffer()),
    listFiles: async id => (await request('files', 'POST', id)).json(),
    removeFile: async (id, name) => { await request('file', 'DELETE', id, name); },
    deleteSong: async id => { await request('song', 'DELETE', id); },
    freeSpace: async () => (await request('space')).json(),
    open: async id => { await request('open', 'POST', id); },
  };
}
