// Шрифты субтитров: встроенные (app/fonts) и свои из MEGA «Для монтажа ПАК» (скачиваются на устройство один раз).
import { db, settings } from "./store.js";
import { cloud, PATHS } from "./cloud.js";
import { FONTS } from "./subs.mjs";

const loaded = new Map();   // имя → Promise
const fontName = (file) => file.replace(/\.[^.]+$/, "").normalize("NFC");

// Список своих шрифтов: [{ name, path }] (path — папка в MEGA). Запоминается, чтобы открываться без сети.
export async function packFonts(refresh) {
  let list = settings.get("packFonts");
  if (!list || refresh) {
    const found = await cloud.find(PATHS.pack, /\.(ttf|otf)$/i);
    const seen = new Set(Object.keys(FONTS));
    list = [];
    for (const f of found.sort((a, b) => a.name.localeCompare(b.name, "ru"))) { const name = fontName(f.name); if (!seen.has(name)) { seen.add(name); list.push({ name, file: f.name, path: f.path }); } }
    settings.set("packFonts", list);
  }
  return list;
}
export const packFont = (name) => (settings.get("packFonts") || []).find((f) => f.name === name) || null;
export const fontReady = (name) => loaded.has(name);
export const haveLocal = async () => new Set((await db.keys("blobs")).filter((k) => String(k).startsWith("font:")).map((k) => k.slice(5)));

// Подключить шрифт к странице (и скачать, если это свой шрифт, которого ещё нет на устройстве).
export function useFont(name) {
  if (loaded.has(name)) return loaded.get(name);
  const p = (async () => {
    let src;
    if (FONTS[name]) src = `url(fonts/${FONTS[name]})`;
    else {
      let blob = await db.get("blobs", "font:" + name);
      if (!blob) {
        const f = packFont(name);
        if (!f) throw new Error("Шрифт «" + name + "» не найден в MEGA.");
        blob = await cloud.download(f.path, f.file);
        await db.put("blobs", blob, "font:" + name);
      }
      src = await blob.arrayBuffer();
    }
    const face = await new FontFace(name, src).load();
    document.fonts.add(face);
  })();
  loaded.set(name, p);
  p.catch(() => loaded.delete(name));
  return p;
}
