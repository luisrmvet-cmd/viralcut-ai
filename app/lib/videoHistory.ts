// app/lib/videoHistory.ts
// Histórico de vídeos gerados (client-side, sem servidor e sem login).
// - Metadados (duração, data, tamanho) em localStorage.
// - Bytes do vídeo em IndexedDB (localStorage não comporta vídeos: teto ~5MB).

export interface VideoHistoryItem {
  id: string;
  duration: number; // segundos
  createdAt: number; // epoch ms
  size: number; // bytes
  fileName: string;
}

const META_KEY = "viralcut:history";
const DB_NAME = "viralcut";
const STORE = "videos";

/* ---------- metadados (localStorage) ---------- */

function readMeta(): VideoHistoryItem[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as VideoHistoryItem[]) : [];
  } catch {
    return [];
  }
}

function writeMeta(items: VideoHistoryItem[]): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(items));
  } catch {
    /* quota/serialização — ignora silenciosamente */
  }
}

/* ---------- bytes do vídeo (IndexedDB) ---------- */

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putBlob(id: string, blob: Blob): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function getBlobById(id: string): Promise<Blob | null> {
  return openDB().then(
    (db) =>
      new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(id);
        r.onsuccess = () => resolve((r.result as Blob) ?? null);
        r.onerror = () => reject(r.error);
      })
  );
}

function delBlob(id: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

/* ---------- API pública ---------- */

/** Salva um vídeo recém-gerado no histórico e retorna o item criado. */
export async function addVideo(
  blob: Blob,
  duration: number
): Promise<VideoHistoryItem> {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const item: VideoHistoryItem = {
    id,
    duration,
    createdAt: Date.now(),
    size: blob.size,
    fileName: `viralcut-${duration}s-${id.slice(0, 8)}.mp4`,
  };

  await putBlob(id, blob);
  writeMeta([item, ...readMeta()]);
  return item;
}

/** Lista os itens do histórico, mais recentes primeiro. */
export function listVideos(): VideoHistoryItem[] {
  return readMeta().sort((a, b) => b.createdAt - a.createdAt);
}

/** Recupera os bytes de um vídeo para baixar novamente. */
export function getVideoBlob(id: string): Promise<Blob | null> {
  return getBlobById(id);
}

/** Remove um item do histórico (metadados + bytes). */
export async function deleteVideo(id: string): Promise<void> {
  await delBlob(id).catch(() => {});
  writeMeta(readMeta().filter((i) => i.id !== id));
}
