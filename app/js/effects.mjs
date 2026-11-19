// Эффекты и режимы смешивания — один код для превью (app/js/editor.js) и сборщика (worker/subs.mjs).
// Эффект: { kind, start, end, amount } на дорожке «Эффекты» (P.effects). Рисующие эффекты — на прозрачном слое
// поверх видео; «Тряска» и «Наезд-рывок» двигают сам кадр (fxFrame; у сборщика — тот же расчёт в render.py fx_frame).
// Смешивание: наложение или «Блик» рисуются на отдельном холсте, залитом «нейтральным» цветом режима
// (на нём режим ничего не меняет), и этот холст смешивается с видео: в превью — CSS mix-blend-mode, у сборщика — ffmpeg blend.

export const EFFECTS = [["flash", "Вспышка"], ["out", "В темноту"], ["in", "Из темноты"], ["vignette", "Виньетка"], ["grain", "Зерно"],
  ["leak", "Блик"], ["bars", "Кино-полосы"], ["shake", "Тряска"], ["zoom", "Наезд-рывок"]];
export const FX_LEN = { flash: 0.5, out: 1, in: 1, zoom: 0.6, shake: 1 };   // длина по умолчанию, с; остальные — 3 с
export const fxName = (k) => (EFFECTS.find((x) => x[0] === k) || [, "Эффект"])[1];

// режим → [название, CSS mix-blend-mode, ffmpeg blend, нейтральный цвет]
export const BLENDS = [["normal", "Обычный"], ["screen", "Осветление", "screen", "screen", "#000000"], ["add", "Добавление", "plus-lighter", "addition", "#000000"],
  ["lighten", "Светлее", "lighten", "lighten", "#000000"], ["multiply", "Умножение", "multiply", "multiply", "#ffffff"], ["darken", "Темнее", "darken", "darken", "#ffffff"],
  ["overlay", "Перекрытие", "overlay", "overlay", "#808080"], ["difference", "Разница", "difference", "difference", "#000000"]];
export const blendOf = (k) => BLENDS.find((b) => b[0] === k && k !== "normal") || null;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const on = (f, t) => t >= f.start && t < f.end;
const amt = (f) => f.amount ?? 1;
const edge = (f, t, d) => Math.min(1, (t - f.start) / d, (f.end - t) / d);   // плавные края эффекта

// сдвиг кадра от «Тряски» и «Наезда» в момент t: { scale (множитель), x, y (доли кадра), rot (градусы) }
export function fxFrame(fx, t) {
  let s = 1, x = 0, y = 0, r = 0;
  for (const f of fx || []) {
    if (!on(f, t)) continue;
    const a = amt(f), u = (t - f.start) / Math.max(0.05, f.end - f.start);
    if (f.kind === "shake") {
      const e = clamp(edge(f, t, 0.12), 0, 1) * a, w = 2 * Math.PI;
      x += e * 0.022 * (Math.sin(w * 7.3 * t) + 0.5 * Math.sin(w * 13.1 * t + 1.3));
      y += e * 0.016 * (Math.sin(w * 6.1 * t + 0.4) + 0.5 * Math.sin(w * 11.7 * t + 2.1));
      r += e * 1.2 * Math.sin(w * 4.3 * t + 0.7);
      s *= 1 + 0.07 * e;   // чуть крупнее, чтобы не было видно краёв
    } else if (f.kind === "zoom") {
      s *= 1 + 0.18 * a * (u < 0.2 ? ss(u / 0.2) : 1 - ss((u - 0.2) / 0.8));
    }
  }
  return { scale: s, x, y, rot: r };
}
export const withFx = (fr, fx, t) => {
  const d = fxFrame(fx, t);
  return d.scale === 1 && !d.x && !d.y && !d.rot ? fr : { ...fr, scale: fr.scale * d.scale, x: fr.x + d.x, y: fr.y + d.y, rot: fr.rot + d.rot };
};

// зерно: одна и та же «случайная» плитка (свой генератор — одинаково в браузере и у сборщика), сдвиг меняется 24 раза в секунду
let grainTile = null;
function tile(make) {
  if (grainTile) return grainTile;
  const n = 128, cv = make(n, n), c = cv.getContext("2d"), img = c.createImageData(n, n);
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 16777216; };
  for (let i = 0; i < n * n; i++) { const v = rnd() < 0.5 ? 0 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = Math.round(rnd() * 255); }
  c.putImageData(img, 0, 0);
  return (grainTile = cv);
}

// рисующие эффекты под текстом (виньетка, зерно, полосы) — under=true, поверх всего (вспышка, затемнение) — under=false
export function drawEffects(ctx, W, H, t, fx, make, under) {
  let any = false;
  for (const f of fx || []) {
    if (!on(f, t)) continue;
    const a = amt(f), u = (t - f.start) / Math.max(0.05, f.end - f.start), k = f.kind;
    if (under !== (k === "vignette" || k === "grain" || k === "bars")) continue;
    ctx.save();
    if (k === "flash" || k === "out" || k === "in") {
      const al = k === "flash" ? (u < 0.25 ? ss(u / 0.25) : 1 - ss((u - 0.25) / 0.75)) : k === "out" ? ss(u) : 1 - ss(u);
      ctx.globalAlpha = clamp(al * a, 0, 1); ctx.fillStyle = k === "flash" ? "#ffffff" : "#000000"; ctx.fillRect(0, 0, W, H);
    } else if (k === "vignette") {
      const e = clamp(edge(f, t, 0.3), 0, 1), R = Math.hypot(W, H) / 2;
      const g = ctx.createRadialGradient(W / 2, H / 2, R * 0.35, W / 2, H / 2, R);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${clamp(0.85 * a * e, 0, 1)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else if (k === "grain") {
      const tl = tile(make), sc = Math.max(1, Math.round(Math.min(W, H) / 540)), fr = Math.floor(t * 24);
      ctx.globalAlpha = clamp(0.22 * a * clamp(edge(f, t, 0.2), 0, 1), 0, 1);
      ctx.imageSmoothingEnabled = false;
      const ox = (fr * 37) % 128, oy = (fr * 91) % 128, step = 128 * sc;
      for (let y = -oy * sc; y < H; y += step) for (let x = -ox * sc; x < W; x += step) ctx.drawImage(tl, x, y, step, step);
    } else if (k === "bars") {
      const hb = H * 0.11 * a * ss(Math.min((t - f.start) / 0.35, (f.end - t) / 0.35));
      ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, W, hb); ctx.fillRect(0, H - hb, W, hb);
    } else { ctx.restore(); continue; }
    ctx.restore(); any = true;
  }
  return any;
}

// «Блик»: тёплые пятна света, плывут по кадру; рисуется на холсте «Осветления»
export function drawLeak(ctx, W, H, t, f) {
  const a = amt(f) * clamp(edge(f, t, 0.4), 0, 1), u = t - f.start, R = Math.max(W, H);
  if (a <= 0) return false;
  const spot = (cx, cy, r, col) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${col},${clamp(a, 0, 1)})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  spot(W * (0.1 + 0.25 * Math.sin(u * 0.9)), H * (0.2 + 0.1 * Math.sin(u * 0.6 + 1)), R * 0.55, "255,120,40");
  spot(W * (0.95 - 0.2 * Math.sin(u * 0.7 + 2)), H * (0.75 + 0.1 * Math.sin(u * 0.8)), R * 0.45, "255,60,110");
  ctx.restore();
  return true;
}

// какие холсты смешивания нужны в момент t: режим → список того, что на нём рисовать
export function blendGroups(t, overlays, fx) {
  const g = new Map();
  for (const o of overlays || []) if (blendOf(o.blend) && t >= o.start && t < o.end) { if (!g.has(o.blend)) g.set(o.blend, { ovs: [], fx: [] }); g.get(o.blend).ovs.push(o); }
  for (const f of fx || []) if (f.kind === "leak" && on(f, t)) { if (!g.has("screen")) g.set("screen", { ovs: [], fx: [] }); g.get("screen").fx.push(f); }
  return g;
}
// все режимы проекта (сборщику — сколько слоёв делать)
export function blendModes(overlays, fx) {
  const s = new Set((overlays || []).filter((o) => blendOf(o.blend)).map((o) => o.blend));
  if ((fx || []).some((f) => f.kind === "leak")) s.add("screen");
  return [...s];
}
// холст одного режима: залить нейтральным цветом, нарисовать наложения (drawOv — та же drawOverlays) и блики
export function drawBlend(ctx, W, H, t, mode, grp, drawOv) {
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = blendOf(mode)[4]; ctx.fillRect(0, 0, W, H); ctx.restore();
  if (grp && grp.ovs.length) drawOv(grp.ovs);
  if (grp) for (const f of grp.fx) drawLeak(ctx, W, H, t, f);
}
