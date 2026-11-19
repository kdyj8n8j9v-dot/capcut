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
