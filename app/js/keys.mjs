// Ключевые кадры кадра клипа (как в CapCut): clip.keys = [{ src — секунда исходника, scale, x, y, rot }].
// Между ключами кадр плавно переходит (smoothstep), до первого и после последнего — как у крайнего ключа.
// Ключи привязаны к исходнику: скорость, обрезка и «Разрезать» их не сдвигают. Тот же расчёт — в render.py (key_frame).
import { srcAt, outAt } from "./speed.mjs";

export const KEY_PROPS = ["scale", "x", "y", "rot"];
const FR0 = { scale: 1, x: 0, y: 0, rot: 0 };
const ss = (u) => u * u * (3 - 2 * u);

// кадр клипа в момент src (секунда исходника)
export function frameAtSrc(c, src) {
  const base = { ...FR0, ...(c.frame || {}) }, K = c.keys;
  if (!K || !K.length) return base;
  if (src <= K[0].src) return pick(K[0], base);
  for (let i = 1; i < K.length; i++) {
    if (src <= K[i].src) {
      const a = pick(K[i - 1], base), b = pick(K[i], base), e = ss((src - K[i - 1].src) / Math.max(1e-6, K[i].src - K[i - 1].src));
      const r = {}; for (const p of KEY_PROPS) r[p] = a[p] + (b[p] - a[p]) * e;
      return r;
    }
  }
  return pick(K[K.length - 1], base);
}
const pick = (k, base) => { const r = {}; for (const p of KEY_PROPS) r[p] = k[p] ?? base[p]; return r; };
// кадр в момент local (секунды от начала клипа на таймлайне)
export const frameAt = (c, local) => frameAtSrc(c, srcAt(c, local));
// ключ в этом месте (±1 кадр) или null
export const keyAt = (c, local) => (c.keys || []).find((k) => Math.abs(outAt(c, k.src) - local) < 0.04) || null;
// поставить ключ в этом месте (с текущим видом кадра) и вернуть его для правки
export function addKey(c, local) {
  const src = srcAt(c, local), have = keyAt(c, local);
  if (have) return have;
  const k = { src: Math.round(src * 1000) / 1000, ...frameAt(c, local) };
  c.keys = [...(c.keys || []), k].sort((a, b) => a.src - b.src);
  return k;
}
// разрезать ключи вместе с клипом: каждой половине — свои, на месте разреза — ключ с видом кадра в этот миг
export function splitKeys(c, b, cut) {
  if (!c.keys || !c.keys.length) return;
  const mid = { src: cut, ...frameAtSrc(c, cut) }, K = c.keys;
  c.keys = [...K.filter((k) => k.src < cut), mid];
  b.keys = [{ ...mid }, ...K.filter((k) => k.src > cut).map((k) => ({ ...k }))];
}
// для сборщика: ключи во времени клипа на таймлайне [[секунда, scale, x, y, rot], …]
export const keysForJob = (c) => (c.keys || []).map((k) => [Math.round(outAt(c, k.src) * 1000) / 1000, ...KEY_PROPS.map((p) => +(k[p] ?? FR0[p]).toFixed(4))]);

// Ключи у наложений и текста: obj.keys = [{ t — секунды от начала объекта, …свойства }]. Тот же smoothstep.
// Свойства: наложение — x, y, scale, rot, opacity; текст — x, y, size (в его style).
export const OV_KEYS = ["x", "y", "scale", "rot", "opacity"], TXT_KEYS = ["x", "y", "size"];
export function keyedAt(keys, tau, props, base) {
  const r = {};
  if (!keys || !keys.length) return r;
  const val = (k, p) => k[p] ?? base[p];
  if (tau <= keys[0].t) { for (const p of props) r[p] = val(keys[0], p); return r; }
  for (let i = 1; i < keys.length; i++) {
    if (tau <= keys[i].t) {
      const a = keys[i - 1], b = keys[i], e = ss((tau - a.t) / Math.max(1e-6, b.t - a.t));
      for (const p of props) { const va = val(a, p), vb = val(b, p); r[p] = typeof va === "number" && typeof vb === "number" ? va + (vb - va) * e : vb; }
      return r;
    }
  }
  for (const p of props) r[p] = val(keys[keys.length - 1], p);
  return r;
}
export const objKeyAt = (obj, tau) => (obj.keys || []).find((k) => Math.abs(k.t - tau) < 0.04) || null;
// ключ объекта в момент tau (новый — с видом объекта в этот миг); base — значения без ключей
export function addObjKey(obj, tau, props, base) {
  const have = objKeyAt(obj, tau);
  if (have) return have;
  const k = { t: Math.round(tau * 1000) / 1000, ...pickProps({ ...base, ...keyedAt(obj.keys, tau, props, base) }, props) };
  obj.keys = [...(obj.keys || []), k].sort((a, b) => a.t - b.t);
  return k;
}
const pickProps = (o, props) => { const r = {}; for (const p of props) r[p] = o[p]; return r; };
