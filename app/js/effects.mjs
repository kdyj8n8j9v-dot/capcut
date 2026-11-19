// Эффекты и режимы смешивания — один код для превью (app/js/editor.js) и сборщика (worker/subs.mjs).
// Эффект: { kind, start, end, amount } на дорожке «Эффекты» (P.effects). Рисующие эффекты — на прозрачном слое
// поверх видео; движущие кадр (тряска, наезды, пульс…) — fxFrame; у сборщика тот же расчёт в render.py fx_frame.
// Смешивание: наложение или эффект-свет рисуются на отдельном холсте, залитом «нейтральным» цветом режима
// (на нём режим ничего не меняет), и этот холст смешивается с видео: в превью — CSS mix-blend-mode, у сборщика — ffmpeg blend.

export const EFFECTS = [["flash", "Вспышка"], ["strobe", "Стробоскоп"], ["out", "В темноту"], ["in", "Из темноты"],
  ["kin", "Наезд"], ["kout", "Отъезд"], ["zoom", "Наезд-рывок"], ["pulse", "Пульс"], ["shake", "Тряска"], ["sway", "Покачивание"],
  ["vhs", "Помехи VHS"], ["old", "Старое кино"], ["grain", "Зерно"], ["vignette", "Виньетка"], ["bars", "Кино-полосы"],
  ["leak", "Блик"], ["bokeh", "Боке"], ["warm", "Тёплый свет"], ["cold", "Холодный свет"], ["snow", "Снег"], ["confetti", "Конфетти"]];
export const FX_LEN = { flash: 0.5, strobe: 1, out: 1, in: 1, zoom: 0.6, shake: 1, pulse: 2 };   // длина по умолчанию, с; остальные — 3 с
export const fxName = (k) => (EFFECTS.find((x) => x[0] === k) || [, "Эффект"])[1];
const UNDER = new Set(["vignette", "grain", "bars", "vhs", "old", "snow", "confetti"]);   // под текстом; остальные рисующие — поверх всего
export const FX_BLEND = { leak: "screen", bokeh: "screen", old: "multiply", warm: "overlay", cold: "overlay" };   // свет и тон — смешиванием

// режим → [ключ, название, CSS mix-blend-mode, ffmpeg blend, нейтральный цвет, операция холста]
export const BLENDS = [["normal", "Обычный"], ["screen", "Осветление", "screen", "screen", "#000000", "screen"], ["add", "Добавление", "plus-lighter", "addition", "#000000", "lighter"],
  ["lighten", "Светлее", "lighten", "lighten", "#000000", "lighten"], ["multiply", "Умножение", "multiply", "multiply", "#ffffff", "multiply"], ["darken", "Темнее", "darken", "darken", "#ffffff", "darken"],
  ["overlay", "Перекрытие", "overlay", "overlay", "#808080", "overlay"], ["difference", "Разница", "difference", "difference", "#000000", "difference"]];
export const blendOf = (k) => BLENDS.find((b) => b[0] === k && k !== "normal") || null;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ss = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const on = (f, t) => t >= f.start && t < f.end;
const amt = (f) => f.amount ?? 1;
const edge = (f, t, d) => clamp(Math.min((t - f.start) / d, (f.end - t) / d), 0, 1);   // плавные края эффекта
const hs = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };   // «случайное» число 0…1, всегда одно и то же
const W2 = 2 * Math.PI;

// сдвиг кадра в момент t: { scale (множитель), x, y (доли кадра), rot (градусы) } — render.py fx_frame повторяет это
export function fxFrame(fx, t) {
  let s = 1, x = 0, y = 0, r = 0;
  for (const f of fx || []) {
    if (!on(f, t)) continue;
    const a = amt(f), u = (t - f.start) / Math.max(0.05, f.end - f.start), k = f.kind;
    if (k === "shake") {
      const e = edge(f, t, 0.12) * a;
      x += e * 0.022 * (Math.sin(W2 * 7.3 * t) + 0.5 * Math.sin(W2 * 13.1 * t + 1.3));
      y += e * 0.016 * (Math.sin(W2 * 6.1 * t + 0.4) + 0.5 * Math.sin(W2 * 11.7 * t + 2.1));
      r += e * 1.2 * Math.sin(W2 * 4.3 * t + 0.7);
      s *= 1 + 0.07 * e;   // чуть крупнее, чтобы не было видно краёв
    } else if (k === "zoom") s *= 1 + 0.18 * a * (u < 0.2 ? ss(u / 0.2) : 1 - ss((u - 0.2) / 0.8));
    else if (k === "kin") s *= 1 + 0.15 * a * ss(u);
    else if (k === "kout") s *= 1 + 0.15 * a * (1 - ss(u));
    else if (k === "pulse") s *= 1 + 0.06 * a * Math.pow(Math.abs(Math.cos(Math.PI * 2 * (t - f.start))), 6);
    else if (k === "sway") { const e = edge(f, t, 0.4) * a; r += 2.5 * e * Math.sin(W2 * 0.5 * (t - f.start)); s *= 1 + 0.07 * e; }
    else if (k === "vhs") {
      const fr = Math.floor(t * 15), e = edge(f, t, 0.15) * a;
      x += e * (0.006 * (hs(fr) - 0.5) + (hs(fr + 0.5) > 0.93 ? 0.03 * (hs(fr + 0.3) - 0.5) : 0));
      s *= 1 + 0.02 * e;
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
function grain(ctx, W, H, t, alpha, make) {
  const tl = tile(make), sc = Math.max(1, Math.round(Math.min(W, H) / 540)), fr = Math.floor(t * 24);
  ctx.globalAlpha = clamp(alpha, 0, 1); ctx.imageSmoothingEnabled = false;
  const ox = (fr * 37) % 128, oy = (fr * 91) % 128, step = 128 * sc;
  for (let y = -oy * sc; y < H; y += step) for (let x = -ox * sc; x < W; x += step) ctx.drawImage(tl, x, y, step, step);
  ctx.globalAlpha = 1;
}
function vignette(ctx, W, H, al, inner = 0.35) {
  const R = Math.hypot(W, H) / 2, g = ctx.createRadialGradient(W / 2, H / 2, R * inner, W / 2, H / 2, R);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${clamp(al, 0, 1)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// рисующие эффекты под текстом (under=true) и поверх всего (under=false: вспышка, стробоскоп, затемнение)
export function drawEffects(ctx, W, H, t, fx, make, under) {
  let any = false;
  const m = Math.min(W, H);
  for (const f of fx || []) {
    if (!on(f, t) || FX_BLEND[f.kind] && f.kind !== "old") continue;
    const a = amt(f), u = (t - f.start) / Math.max(0.05, f.end - f.start), k = f.kind, e = edge(f, t, 0.3);
    if (under !== UNDER.has(k)) continue;
    ctx.save();
    if (k === "flash" || k === "out" || k === "in") {
      const al = k === "flash" ? (u < 0.25 ? ss(u / 0.25) : 1 - ss((u - 0.25) / 0.75)) : k === "out" ? ss(u) : 1 - ss(u);
      ctx.globalAlpha = clamp(al * a, 0, 1); ctx.fillStyle = k === "flash" ? "#ffffff" : "#000000"; ctx.fillRect(0, 0, W, H);
    } else if (k === "strobe") {
      if (Math.floor((t - f.start) * 10) % 2 === 0) { ctx.globalAlpha = clamp(0.8 * a, 0, 1); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); }
    } else if (k === "vignette") vignette(ctx, W, H, 0.85 * a * e);
    else if (k === "grain") grain(ctx, W, H, t, 0.22 * a * edge(f, t, 0.2), make);
    else if (k === "bars") {
      const hb = H * 0.11 * a * ss(Math.min((t - f.start) / 0.35, (f.end - t) / 0.35));
      ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, W, hb); ctx.fillRect(0, H - hb, W, hb);
    } else if (k === "old") {   // царапины, мерцание, зерно, виньетка (жёлтый тон — смешиванием, см. drawFxBlend)
      const fr = Math.floor(t * 12), al = a * e;
      ctx.fillStyle = `rgba(0,0,0,${clamp(al * (0.04 + 0.12 * hs(fr * 1.7)), 0, 1)})`; ctx.fillRect(0, 0, W, H);
      vignette(ctx, W, H, 0.7 * al, 0.3);
      for (let i = 0; i < 3; i++) if (hs(fr * 3 + i) > 0.45) {
        const x = hs(fr * 5 + i * 11) * W; ctx.fillStyle = `rgba(30,20,10,${clamp(0.5 * al, 0, 1)})`; ctx.fillRect(x, 0, Math.max(1, m / 500), H);
      }
      grain(ctx, W, H, t, 0.25 * al, make);
    } else if (k === "vhs") {
      const al = a * e, lh = Math.max(2, Math.round(H / 270));
      ctx.fillStyle = `rgba(0,0,0,${clamp(0.18 * al, 0, 1)})`;
      for (let y = 0; y < H; y += lh * 2) ctx.fillRect(0, y, W, lh);   // строки
      const by = ((t * 0.35) % 1.2 - 0.1) * H;   // светлая полоса ползёт вниз
      const g = ctx.createLinearGradient(0, by - H * 0.05, 0, by + H * 0.05);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, `rgba(255,255,255,${clamp(0.22 * al, 0, 1)})`); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, by - H * 0.05, W, H * 0.1);
      const fr = Math.floor(t * 15);
      if (hs(fr + 0.7) > 0.8) { ctx.fillStyle = `rgba(255,0,90,${clamp(0.25 * al, 0, 1)})`; ctx.fillRect(0, hs(fr) * H, W, H * 0.015); ctx.fillStyle = `rgba(0,220,255,${clamp(0.25 * al, 0, 1)})`; ctx.fillRect(0, hs(fr + 2) * H, W, H * 0.01); }
    } else if (k === "snow") {
      const al = a * e; ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 70; i++) {
        const sp = (0.06 + 0.1 * hs(i + 99)) * H, y = ((hs(i + 7) * (H + 40) + t * sp) % (H + 40)) - 20;
        const x = hs(i) * W + Math.sin(t * 1.3 + i) * W * 0.02, r = (1 + 2.2 * hs(i + 3)) * m / 360;
        ctx.globalAlpha = clamp(al * (0.5 + 0.5 * hs(i + 5)), 0, 1); ctx.beginPath(); ctx.arc(x, y, r, 0, W2); ctx.fill();
      }
    } else if (k === "confetti") {
      const cols = ["#ff375f", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ff9f0a"], al = a * e, sz = m / 60;
      for (let i = 0; i < 60; i++) {
        const sp = (0.15 + 0.2 * hs(i + 9)) * H, y = ((hs(i + 4) * (H + 60) + (t - f.start) * sp) % (H + 60)) - 30;
        const x = hs(i + 1) * W + Math.sin(t * 2 + i) * W * 0.03;
        ctx.globalAlpha = clamp(al, 0, 1); ctx.fillStyle = cols[i % cols.length];
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * (2 + 3 * hs(i + 2)) + i); ctx.scale(1, Math.abs(Math.cos(t * 3 + i))); ctx.fillRect(-sz / 2, -sz / 4, sz, sz / 2); ctx.restore();
      }
    } else { ctx.restore(); continue; }
    ctx.restore(); any = true;
  }
  return any;
}

// эффекты-свет и тон на холсте своего режима смешивания
function drawFxBlend(ctx, W, H, t, f) {
  const a = amt(f) * edge(f, t, 0.4), u = t - f.start, R = Math.max(W, H), k = f.kind;
  if (a <= 0) return;
  const spot = (cx, cy, r, col, al) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${col},${clamp(al, 0, 1)})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  ctx.save();
  if (k === "leak") {   // тёплые пятна света, плывут по кадру
    ctx.globalCompositeOperation = "lighter";
    spot(W * (0.1 + 0.25 * Math.sin(u * 0.9)), H * (0.2 + 0.1 * Math.sin(u * 0.6 + 1)), R * 0.55, "255,120,40", a);
    spot(W * (0.95 - 0.2 * Math.sin(u * 0.7 + 2)), H * (0.75 + 0.1 * Math.sin(u * 0.8)), R * 0.45, "255,60,110", a);
  } else if (k === "bokeh") {   // мягкие круги света
    ctx.globalCompositeOperation = "lighter";
    const cols = ["255,190,120", "255,140,170", "160,200,255", "255,230,160"];
    for (let i = 0; i < 16; i++) {
      const cx = (hs(i) + 0.03 * Math.sin(u * 0.5 + i)) * W, cy = (hs(i + 20) + 0.04 * Math.sin(u * 0.4 + i * 2)) * H;
      spot(cx, cy, R * (0.04 + 0.06 * hs(i + 40)), cols[i % 4], a * (0.35 + 0.35 * Math.sin(u * 1.5 + i) ** 2));
    }
  } else if (k === "old") { ctx.fillStyle = `rgba(232,196,130,${clamp(0.7 * a, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
  else if (k === "warm") { ctx.fillStyle = `rgba(255,150,40,${clamp(0.4 * a, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
  else if (k === "cold") { ctx.fillStyle = `rgba(40,130,255,${clamp(0.4 * a, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}

// какие холсты смешивания нужны в момент t: режим → что на нём рисовать
export function blendGroups(t, overlays, fx) {
  const g = new Map(), grp = (m) => { if (!g.has(m)) g.set(m, { ovs: [], fx: [] }); return g.get(m); };
  for (const o of overlays || []) if (blendOf(o.blend) && t >= o.start && t < o.end) grp(o.blend).ovs.push(o);
  for (const f of fx || []) if (FX_BLEND[f.kind] && on(f, t)) grp(FX_BLEND[f.kind]).fx.push(f);
  return g;
}
// все режимы проекта (сборщику — сколько слоёв делать)
export function blendModes(overlays, fx) {
  const s = new Set((overlays || []).filter((o) => blendOf(o.blend)).map((o) => o.blend));
  for (const f of fx || []) if (FX_BLEND[f.kind]) s.add(FX_BLEND[f.kind]);
  return [...s];
}
// холст одного режима: залить нейтральным цветом, нарисовать наложения (drawOv — та же drawOverlays) и эффекты-свет
export function drawBlend(ctx, W, H, t, mode, grp, drawOv) {
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = blendOf(mode)[4]; ctx.fillRect(0, 0, W, H); ctx.restore();
  if (grp && grp.ovs.length) drawOv(grp.ovs);
  if (grp) for (const f of grp.fx) drawFxBlend(ctx, W, H, t, f);
}

// живой образец эффекта на плитке: кадр bg (картинка/холст) + эффект в момент t (эффект идёт с 0,2 с)
let demoTmp = null;
export function fxDemoLen(kind) { return (FX_LEN[kind] || 2) + 0.6; }
export function drawDemo(ctx, W, H, bg, kind, t, make) {
  const f = { kind, start: 0.2, end: 0.2 + (FX_LEN[kind] || 2), amount: 1 }, d = fxFrame([f], t);
  ctx.save(); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (bg && bg.width) {
    ctx.translate(W / 2 + d.x * W, H / 2 + d.y * H); ctx.rotate(d.rot * Math.PI / 180);
    const s = d.scale * Math.max(W / bg.width, H / bg.height); ctx.scale(s, s); ctx.drawImage(bg, -bg.width / 2, -bg.height / 2);
  }
  ctx.restore();
  const m = FX_BLEND[kind];
  if (m && on(f, t)) {
    if (!demoTmp || demoTmp.width !== W || demoTmp.height !== H) demoTmp = make(W, H);
    const tx = demoTmp.getContext("2d");
    drawBlend(tx, W, H, t, m, { ovs: [], fx: [f] });
    ctx.save(); ctx.globalCompositeOperation = blendOf(m)[5]; ctx.drawImage(demoTmp, 0, 0); ctx.restore();
  }
  drawEffects(ctx, W, H, t, [f], make, true); drawEffects(ctx, W, H, t, [f], make, false);
}
