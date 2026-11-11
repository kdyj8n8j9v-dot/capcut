// Хранилище на устройстве: проекты, сведения о файлах и сами файлы для превью (IndexedDB), настройки (localStorage).
let dbp;
function open() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open("studio", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("projects", { keyPath: "id" });
      r.result.createObjectStore("media", { keyPath: "key" });
      r.result.createObjectStore("blobs");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const q = fn(t.objectStore(store));
    t.oncomplete = () => res(q && q.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const db = {
  get: (s, k) => tx(s, "readonly", (o) => o.get(k)),
  all: (s) => tx(s, "readonly", (o) => o.getAll()),
  keys: (s) => tx(s, "readonly", (o) => o.getAllKeys()),
  put: (s, v, k) => tx(s, "readwrite", (o) => o.put(v, k)),
  del: (s, k) => tx(s, "readwrite", (o) => o.delete(k)),
};
export const settings = {
  get(k) { try { return JSON.parse(localStorage.getItem("studio." + k)); } catch { return null; } },
  set(k, v) { v == null ? localStorage.removeItem("studio." + k) : localStorage.setItem("studio." + k, JSON.stringify(v)); },
};
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// Имя файла исполнителю передаётся как «#<16 знаков sha256 имени>» (worker/find.py), чтобы оно не попадало в публичный журнал.
export async function nameKey(name) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name.normalize("NFC")));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
