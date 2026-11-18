// Скорость клипа: постоянная (clip.speed) или кривая (clip.curve — точки [доля клипа 0..1, скорость]).
// Один расчёт для превью, субтитров и экспорта; сборщику уходит готовая таблица «исходник ↔ ролик» (curveMap).
export const CURVES = [
  ["montage", "Монтаж", [[0, 1], [0.25, 3], [0.5, 0.4], [0.75, 3], [1, 1]]],
  ["hero", "Герой", [[0, 1.5], [0.35, 1.5], [0.5, 0.3], [0.65, 1.5], [1, 1.5]]],
  ["bullet", "Пуля", [[0, 1.2], [0.4, 1.2], [0.5, 0.2], [0.6, 1.2], [1, 1.2]]],
  ["rampUp", "Плавный разгон", [[0, 0.5], [0.5, 1.2], [1, 3]]],
  ["rampDown", "Плавное торможение", [[0, 3], [0.5, 1.2], [1, 0.5]]],
  ["flashIn", "Вспышка: вход", [[0, 5], [0.3, 4], [0.5, 1], [1, 1]]],
  ["flashOut", "Вспышка: выход", [[0, 1], [0.5, 1], [0.7, 4], [1, 5]]],
  ["jump", "Прыжок", [[0, 1], [0.42, 1], [0.5, 5], [0.58, 1], [1, 1]]],
];
export const VMIN = 0.1, VMAX = 10;
const N = 240;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// скорость в точке u (доля клипа по исходнику): плавно между точками кривой
export function speedAt(pts, u) {
  if (!pts || !pts.length) return 1;
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [u1, v1] = pts[i], [u0, v0] = pts[i - 1];
    if (u <= u1) { const k = (u - u0) / Math.max(1e-9, u1 - u0), e = k * k * (3 - 2 * k); return clamp(v0 + (v1 - v0) * e, VMIN, VMAX); }
  }
  return pts[pts.length - 1][1];
}
const cache = new Map();
// таблица: src[i] — секунда исходника от начала клипа, out[i] — секунда ролика от начала клипа
function table(c) {
  const S = Math.max(1e-6, c.out - c.in), key = S.toFixed(4) + JSON.stringify(c.curve);
  let t = cache.get(key);
  if (t) return t;
  const src = new Float64Array(N + 1), out = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    src[i + 1] = S * (i + 1) / N;
    out[i + 1] = out[i] + (S / N) / speedAt(c.curve, (i + 0.5) / N);
  }
  t = { src, out };
  cache.set(key, t); if (cache.size > 200) cache.delete(cache.keys().next().value);
  return t;
}
const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[N]) return ys[N];
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / Math.max(1e-12, xs[hi] - xs[lo]);
};
// длина клипа на таймлайне
export const clipLen = (c) => (c.curve ? table(c).out[N] : (c.out - c.in) / (c.speed || 1));
// секунда исходника для момента local от начала клипа на таймлайне
export const srcAt = (c, local) => c.in + (c.curve ? interp(table(c).out, table(c).src, local) : local * (c.speed || 1));
// момент на таймлайне (от начала клипа) для секунды исходника
export const outAt = (c, src) => (c.curve ? interp(table(c).src, table(c).out, src - c.in) : (src - c.in) / (c.speed || 1));
// скорость в момент local (для playbackRate в превью)
export const rateAt = (c, local) => (c.curve ? speedAt(c.curve, (srcAt(c, local) - c.in) / Math.max(1e-6, c.out - c.in)) : c.speed || 1);
// таблица для сборщика: [[секунда исходника, секунда ролика], …] от начала клипа
export function curveMap(c, n = 96) {
  const t = table(c), out = [];
  for (let i = 0; i <= n; i++) { const j = Math.round(i * N / n); out.push([Math.round(t.src[j] * 1e4) / 1e4, Math.round(t.out[j] * 1e4) / 1e4]); }
  return out;
}
// разрезать кривую в точке u (доля исходника): две кривые для двух половин
export function splitCurve(pts, u) {
  const a = [], b = [], v = speedAt(pts, u);
  for (const [x, y] of pts) { if (x < u) a.push([x / u, y]); if (x > u) b.push([(x - u) / (1 - u), y]); }
  a.push([1, v]); b.unshift([0, v]);
  return [a, b];
}
