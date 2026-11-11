// Медиатека: что лежит в MEGA и на устройстве, копии для превью (прокси), подготовка сборщиком, загрузка с устройства.
import { db, settings, nameKey, uid } from "./store.js";
import { cloud, PATHS } from "./cloud.js";
import { github, waitRun } from "./github.js";

const VIDEO = /\.(mov|mp4|m4v|mxf)$/i;
const stem = (n) => n.replace(/\.[^.]+$/, "");
const files = new Map();   // key → File, выбранный с устройства в этом сеансе (превью сразу, без ожидания)
const urls = new Map();    // key → адрес для <video>
const busy = new Map();    // key → { text, p } — что сейчас происходит с файлом
const subs = new Set();
export const onMedia = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((f) => f());
const setBusy = (key, text, p) => { text == null ? busy.delete(key) : busy.set(key, { text, p }); emit(); };
export const busyOf = (key) => busy.get(key);

// Список для окна «Медиа»: файлы MEGA «Исходники» + то, что уже есть на устройстве.
export async function library(refresh) {
  if (refresh) await cloud.refresh();
  const [src, studio, known, have] = await Promise.all([cloud.list(PATHS.in), cloud.list(PATHS.studio), db.all("media"), db.keys("blobs")]);
  const proxies = new Set((studio || []).map((f) => f.name));
  const byKey = new Map(known.map((m) => [m.key, m]));
  const out = [];
  for (const f of (src || []).filter((f) => !f.dir && VIDEO.test(f.name))) {
    const key = await nameKey(f.name);
    const m = { ...(byKey.get(key) || {}), key, name: f.name, size: f.size, ts: f.ts, inCloud: true };
    m.local = have.includes(key) || files.has(key);
    m.proxy = proxies.has(stem(f.name) + ".proxy.mp4");
    byKey.delete(key); out.push(m);
  }
  for (const m of byKey.values()) out.push({ ...m, local: have.includes(m.key) || files.has(m.key), inCloud: !!m.uploaded });
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// Адрес для превью: файл этого сеанса или сохранённая копия. null — на устройстве копии нет.
export async function mediaUrl(key) {
  if (urls.has(key)) return urls.get(key);
  const b = files.get(key) || await db.get("blobs", key);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(key, u);
  return u;
}

export function probe(url) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.playsInline = true;
    const t = setTimeout(() => rej(new Error("timeout")), 15000);
    v.onloadedmetadata = () => { clearTimeout(t); v.videoWidth ? res({ dur: v.duration, w: v.videoWidth, h: v.videoHeight }) : rej(new Error("novideo")); v.src = ""; };
    v.onerror = () => { clearTimeout(t); rej(new Error("format")); };
    v.src = url;
  });
}

async function saveMeta(m) {
  const old = await db.get("media", m.key);
  const rec = { ...(old || {}), ...m };
  for (const k of ["local", "proxy", "inCloud"]) delete rec[k];
  await db.put("media", rec);
  return rec;
}

// Скачать копию для превью (и слова речи) из MEGA на устройство.
async function fetchProxy(m) {
  setBusy(m.key, "Скачиваю", 0);
  const blob = await cloud.download(PATHS.studio, stem(m.name) + ".proxy.mp4", (p) => setBusy(m.key, "Скачиваю", p));
  await db.put("blobs", new Blob([blob], { type: "video/mp4" }), m.key);
  const old = urls.get(m.key); if (old && !files.has(m.key)) { URL.revokeObjectURL(old); urls.delete(m.key); }
  try { await db.put("blobs", await cloud.getText(PATHS.studio, stem(m.name) + ".transcript.json"), m.key + ".words"); } catch {}
  const info = await probe(await mediaUrl(m.key));
  return saveMeta({ key: m.key, name: m.name, size: m.size, ts: m.ts, ...info });
}

const PHASE = { queued: "В очереди", setup: "Готовлю сборщик", work: "Готовлю копию" };
// Попросить сборщик сделать копию для превью и субтитры (около 3–4 минут), затем скачать её.
async function prepare(m) {
  let job = (settings.get("prep") || {})[m.key];
  if (!job || Date.now() - job.at > 6 * 3600e3) {
    job = { req: "p" + uid(), at: Date.now() };
    setBusy(m.key, "Отправляю");
    await github.dispatch("prepare", { file: "#" + m.key, req: job.req });
    settings.set("prep", { ...(settings.get("prep") || {}), [m.key]: job });
  }
  const forget = () => { const p = settings.get("prep") || {}; delete p[m.key]; settings.set("prep", p); };
  const s = await waitRun(job.req, (ph) => PHASE[ph] && setBusy(m.key, PHASE[ph]));
  forget();
  if (s.phase !== "done") throw new Error("Сборщик не смог подготовить файл. Подходит видео с камеры или телефона (MOV, MP4).");
  await cloud.refresh();
}

// Сделать файл готовым к монтажу: возвращает запись с длительностью и размером кадра.
export async function ensure(m) {
  if (busy.has(m.key)) return null;
  try {
    if (await mediaUrl(m.key)) {
      const rec = await db.get("media", m.key);
      if (rec && rec.dur) return rec;
      return await saveMeta({ key: m.key, name: m.name, size: m.size, ts: m.ts, ...(await probe(await mediaUrl(m.key))) });
    }
    if (!m.proxy) await prepare(m);
    return await fetchProxy(m);
  } finally { setBusy(m.key, null); }
}

// Продолжить подготовки, начатые до перезапуска приложения.
export async function resumePending() {
  const p = settings.get("prep") || {};
  if (!Object.keys(p).length || !cloud.signedIn() || !github.has()) return;
  const lib = await library().catch(() => []);
  for (const m of lib) if (p[m.key] && !m.local) ensure(m).catch(() => {});
}

// Файл с устройства: превью сразу (если устройство умеет его показать), оригинал — в MEGA «Исходники» для сборщика.
export async function addFromDevice(file) {
  const key = await nameKey(file.name);
  files.set(key, file); urls.delete(key);
  let info = null;
  try { info = await probe(await mediaUrl(key)); } catch { files.delete(key); urls.delete(key); }
  const rec = await saveMeta({ key, name: file.name.normalize("NFC"), size: file.size, ts: Math.floor(Date.now() / 1000), device: true, ...(info || {}) });
  const upload = (async () => {
    try {
      const there = (await cloud.list(PATHS.in) || []).find((f) => f.name === rec.name && f.size === file.size);
      if (!there) {
        setBusy(key, "Загружаю в MEGA", 0);
        await cloud.upload(PATHS.in, rec.name, file, (p) => setBusy(key, "Загружаю в MEGA", p));
      }
      await saveMeta({ key, uploaded: true });
      setBusy(key, null);
      // копия для превью и слова речи — чтобы файл открывался и после перезапуска приложения
      await ensureProxy({ ...rec, proxy: false });
    } catch (e) { setBusy(key, null); throw e; }
  })();
  return { rec: info ? rec : null, upload };
}
async function ensureProxy(m) {
  try { await prepare(m); await fetchProxy(m); } finally { setBusy(m.key, null); }
}

export async function isUploaded(key) {
  const rec = await db.get("media", key);
  if (rec && !rec.device) return true;
  const list = await cloud.list(PATHS.in) || [];
  return !!rec && list.some((f) => f.name === rec.name);
}
export const wordsOf = async (key) => { try { return JSON.parse(await db.get("blobs", key + ".words")); } catch { return null; } };

// Слова речи файла: с устройства, иначе из MEGA, иначе просим сборщик распознать (около 4 минут).
export async function ensureWords(key, name) {
  let w = await wordsOf(key);
  if (w && w.words) return w.words;
  const file = stem(name) + ".transcript.json";
  const pull = async () => { const t = await cloud.getText(PATHS.studio, file); await db.put("blobs", t, key + ".words"); return JSON.parse(t).words || []; };
  try { return await pull(); } catch {}
  if (busy.has(key)) throw new Error("Файл ещё обрабатывается. Попробуйте, когда загрузка закончится.");
  try { setBusy(key, "Распознаю речь"); await prepare({ key, name }); return await pull(); } finally { setBusy(key, null); }
}
