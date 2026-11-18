// Наложения: фото, стикеры и видео поверх основного видео. Один и тот же код рисует превью в приложении
// и готовое видео на сборщике (worker/subs.mjs) — поэтому превью совпадает с итогом. Здесь нет ничего от браузера.
import { drawMaskCached, ease } from "./subs.mjs";

export const OV_DEFAULT = { x: 0.5, y: 0.5, scale: 0.6, rot: 0, opacity: 1, radius: 0, flip: false,
  in: "fade", inDur: 0.3, out: "fade", outDur: 0.3, loop: "none" };
export const OV_IN = [["none", "Нет"], ["fade", "Проявление"], ["pop", "Прыжок"], ["zoom", "Уменьшение"], ["up", "Снизу"], ["down", "Сверху"], ["left", "Слева"], ["right", "Справа"], ["spin", "Поворот"], ["wipe", "Шторка"]];
export const OV_OUT = [["none", "Нет"], ["fade", "Затухание"], ["pop", "Сжатие"], ["zoom", "Увеличение"], ["up", "Вверх"], ["down", "Вниз"], ["left", "Влево"], ["right", "Вправо"], ["wipe", "Шторка"]];
export const OV_LOOP = [["none", "Нет"], ["zoomIn", "Медленный наезд"], ["zoomOut", "Медленный отъезд"], ["float", "Парение"], ["pulse", "Пульс"], ["swing", "Качание"]];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const eo = (p) => 1 - Math.pow(1 - p, 3);
const back = (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);

// Положение и вид наложения в момент t: { cx, cy, w, h, rot, sx, sy, a, clip } или null, если его не видно.
// srcW, srcH — размер картинки или кадра видео.
export function ovPose(o0, t, W, H, srcW, srcH) {
  const o = { ...OV_DEFAULT, ...o0 };
  if (t < o.start || t >= o.end || !srcW || !srcH) return null;
  const w = o.scale * W, h = w * srcH / srcW, tau = t - o.start, len = o.end - o.start;
  const F = { cx: o.x * W, cy: o.y * H, w, h, rot: o.rot * Math.PI / 180, sx: o.flip ? -1 : 1, sy: 1, a: o.opacity, clip: null };
  const fx = (kind, p, dir, how) => {
    const own = how && how !== "auto", e = own ? ease(how, p) : eo(p), d = Math.max(w, h) * 0.25;
    switch (kind) {
      case "fade": F.a *= own ? clamp(e, 0, 1) : p; break;
      case "pop": { const s = own ? e : dir > 0 ? back(p) : e; F.sx *= s; F.sy *= s; F.a *= Math.min(1, p * 3); break; }
      case "zoom": { const s = 1.4 - 0.4 * e; F.sx *= s; F.sy *= s; F.a *= p; break; }
      case "up": F.cy += dir * (1 - e) * d; F.a *= p; break;
      case "down": F.cy -= dir * (1 - e) * d; F.a *= p; break;
      case "left": F.cx -= dir * (1 - e) * d * 1.5; F.a *= p; break;
      case "right": F.cx += dir * (1 - e) * d * 1.5; F.a *= p; break;
      case "spin": F.rot -= (1 - e) * 0.6; F.sx *= 0.4 + 0.6 * e; F.sy *= 0.4 + 0.6 * e; F.a *= p; break;
      case "wipe": F.clip = dir > 0 ? [0, e] : [1 - e, 1]; break;
    }
  };
  if (o.in !== "none") fx(o.in, clamp(tau / Math.max(0.01, o.inDur), 0, 1), 1, o.inEase);
  if (o.out !== "none") { const q = clamp((o.end - t) / Math.max(0.01, o.outDur), 0, 1); if (q < 1) fx(o.out, q, -1, o.outEase); }
  const k = clamp(tau / Math.max(0.1, len), 0, 1);
  if (o.loop === "zoomIn") { F.sx *= 1 + 0.12 * k; F.sy *= 1 + 0.12 * k; }
  else if (o.loop === "zoomOut") { F.sx *= 1.12 - 0.12 * k; F.sy *= 1.12 - 0.12 * k; }
  else if (o.loop === "float") F.cy += h * 0.03 * Math.sin(tau * 2.5);
  else if (o.loop === "pulse") { const s = 1 + 0.04 * Math.sin(tau * 6); F.sx *= s; F.sy *= s; }
  else if (o.loop === "swing") F.rot += 0.06 * Math.sin(tau * 3);
  return F.a > 0.002 ? F : null;
}

// Нарисовать все наложения момента t. src(o) → { img, w, h } — что рисовать (картинка, видео, холст) и его размер.
// make(w, h) → новый холст (в браузере — document.createElement, на сборщике — createCanvas): нужен для масок и скруглений.
// fresh(w, h) — холст, который можно хранить (для готовых масок); по умолчанию make.
export function drawOverlays(ctx, W, H, t, overlays, src, make, fresh = make) {
  const list = (overlays || []).filter((o) => t >= o.start && t < o.end).sort((a, b) => (a.layer | 0) - (b.layer | 0));
  let any = false;
  for (const o of list) {
    const s = src(o);
    if (!s || !s.img) continue;
    const F = ovPose(o, t, W, H, s.w, s.h);
    if (!F) continue;
    const ow = Math.max(1, Math.round(F.w)), oh = Math.max(1, Math.round(F.h));
    let img = s.img;
    const m = o.mask && o.mask.shape && o.mask.shape !== "none" ? o.mask : null, r = (o.radius || 0) * Math.min(ow, oh) / 2;
    if (m || r > 0.5) {
      // маска и скругление — на своём холсте размером с наложение
      const c = make(ow, oh), g = c.getContext("2d");
      if (r > 0.5) { g.beginPath(); if (g.roundRect) g.roundRect(0, 0, ow, oh, r); else g.rect(0, 0, ow, oh); g.clip(); }
      g.drawImage(img, 0, 0, ow, oh);
      if (m) {
        g.globalCompositeOperation = "destination-out";
        drawMaskCached(g, ow, oh, m, fresh);   // чёрное там, где наложение должно исчезнуть (считается один раз)
      }
      img = c;
    }
    ctx.save();
    ctx.globalAlpha = clamp(F.a, 0, 1);
    ctx.translate(F.cx, F.cy); ctx.rotate(F.rot); ctx.scale(F.sx, F.sy);
    if (F.clip) { ctx.beginPath(); ctx.rect(-F.w / 2 + F.w * F.clip[0], -F.h / 2, F.w * (F.clip[1] - F.clip[0]), F.h); ctx.clip(); }
    ctx.drawImage(img, -F.w / 2, -F.h / 2, F.w, F.h);
    ctx.restore();
    any = true;
  }
  return any;
}

// Какое наложение под точкой (px, py) в момент t — для выбора пальцем на видео. Верхнее — первым.
export function ovAt(overlays, t, W, H, px, py, size) {
  const list = (overlays || []).filter((o) => t >= o.start && t < o.end).sort((a, b) => (b.layer | 0) - (a.layer | 0));
  for (const o of list) {
    const s = size(o); if (!s) continue;
    const F = ovPose({ ...o, in: "none", out: "none" }, t, W, H, s.w, s.h); if (!F) continue;
    const dx = px - F.cx, dy = py - F.cy, c = Math.cos(-F.rot), n = Math.sin(-F.rot);
    const lx = dx * c - dy * n, ly = dx * n + dy * c;
    if (Math.abs(lx) <= F.w / 2 && Math.abs(ly) <= F.h / 2) return o;
  }
  return null;
}
