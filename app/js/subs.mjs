// Субтитры: разбивка слов на строки и отрисовка. Один и тот же код рисует превью в приложении
// и готовое видео на сборщике (worker/subs.mjs) — поэтому превью совпадает с итогом. Здесь нет ничего от браузера.
export const FONTS = { Montserrat: "Montserrat_800ExtraBold.ttf", Inter: "Inter_800ExtraBold.ttf", Rubik: "Rubik_800ExtraBold.ttf", Oswald: "Oswald_600SemiBold.ttf", Caveat: "Caveat_700Bold.ttf" };
export const SUB_DEFAULT = {
  font: "Montserrat", size: 0.07, x: 0.5, y: 0.72, rot: 0, align: "center", ls: 0, ws: 0, lh: 1.25, sx: 1, sy: 1, wrap: 0.9, italic: false, case: "none", punct: true, maxChars: 16, shift: 0,
  color: "#ffffff", color2: "", opacity: 1,
  stroke: 0, strokeColor: "#000000",
  shadow: 0.35, shadowColor: "#000000", shadowBlur: 0.4,
  glow: 0, glowColor: "#ffd60a",
  bg: 0, bgColor: "#000000", bgRadius: 0.3, bgPad: 0.25,
  cloud: 0, cloudColor: "#000000", cloudSize: 1, cloudTall: 1, cloudSoft: 0.6,
  hl: "color", hlColor: "#ffd60a", reveal: false, dim: false, emColor: "#ff375f",
  in: "pop", inDur: 0.25, out: "none", outDur: 0.2, loop: "none",
};
export const ANIM_IN = [["none", "Нет"], ["fade", "Проявление"], ["pop", "Прыжок"], ["zoom", "Уменьшение"], ["up", "Снизу"], ["down", "Сверху"], ["left", "Слева"], ["right", "Справа"],
  ["drop", "Падение"], ["stomp", "Удар"], ["spring", "Пружина"], ["spin", "Поворот"], ["flip", "Разворот"], ["wipe", "Шторка"], ["wipeUp", "Шторка вверх"], ["wipeC", "Из центра"], ["type", "Печать"], ["letters", "По буквам"], ["words", "По словам"]];
export const ANIM_OUT = [["none", "Нет"], ["fade", "Затухание"], ["pop", "Сжатие"], ["zoom", "Увеличение"], ["up", "Вверх"], ["down", "Вниз"], ["left", "Влево"], ["right", "Вправо"], ["wipe", "Шторка"], ["wipeC", "К центру"], ["flip", "Разворот"]];
export const ANIM_LOOP = [["none", "Нет"], ["pulse", "Пульс"], ["shake", "Дрожь"], ["swing", "Качание"], ["float", "Парение"], ["wave", "Волна"]];
export const HL = [["none", "Нет"], ["color", "Цвет"], ["pop", "Прыжок"], ["box", "Плашка"], ["under", "Черта"], ["fill", "Заливка"], ["keep", "Закрашивание"], ["bounce", "Подскок"], ["glow", "Свечение"]];
const P0 = { color2: "", cloud: 0, bg: 0, shadow: 0, glow: 0, reveal: false, dim: false, out: "none", loop: "none", italic: false, ls: 0, ws: 0, sx: 1, sy: 1, case: "none", stroke: 0, shadow: 0.35, shadowColor: "#000000", strokeColor: "#000000", color: "#ffffff", in: "pop", inDur: 0.25 };
export const PRESETS = [
  ["Классика", { ...P0, font: "Inter", size: 0.06, maxChars: 22, hl: "none", in: "fade" }],
  ["Караоке", { ...P0, font: "Montserrat", size: 0.07, maxChars: 16, hl: "color", hlColor: "#ffd60a" }],
  ["Прыжок", { ...P0, font: "Montserrat", size: 0.075, maxChars: 14, case: "upper", hl: "pop", hlColor: "#30d158" }],
  ["Плашка", { ...P0, font: "Rubik", size: 0.065, maxChars: 16, hl: "box", hlColor: "#0a84ff" }],
  ["По слову", { ...P0, font: "Oswald", size: 0.085, maxChars: 16, case: "upper", hl: "none", reveal: true, in: "none" }],
  ["Одно слово", { ...P0, font: "Montserrat", size: 0.11, maxChars: 1, case: "upper", hl: "color", hlColor: "#ffd60a" }],
  ["Заливка", { ...P0, font: "Montserrat", size: 0.07, maxChars: 16, hl: "fill", hlColor: "#ff9f0a", in: "up" }],
  ["Неон", { ...P0, font: "Rubik", size: 0.07, maxChars: 16, shadow: 0, glow: 0.8, glowColor: "#bf5af2", hl: "color", hlColor: "#ff9ff3", in: "fade", loop: "pulse" }],
  ["Подложка", { ...P0, font: "Inter", size: 0.055, maxChars: 22, shadow: 0, bg: 0.75, bgColor: "#000000", hl: "color", hlColor: "#ffd60a", in: "fade" }],
  ["Градиент", { ...P0, font: "Montserrat", size: 0.08, maxChars: 14, case: "upper", color: "#ffd60a", color2: "#ff375f", hl: "pop", hlColor: "#ffffff", in: "zoom" }],
  ["Печать", { ...P0, font: "Inter", size: 0.06, maxChars: 20, hl: "none", in: "type", inDur: 0.5 }],
  ["Рукой", { ...P0, font: "Caveat", size: 0.1, maxChars: 18, hl: "under", hlColor: "#ff375f", in: "wipe", inDur: 0.35 }],
  ["Удар", { ...P0, font: "Montserrat", size: 0.085, maxChars: 12, case: "upper", hl: "bounce", hlColor: "#ffd60a", in: "stomp", inDur: 0.2 }],
  ["Тишина", { ...P0, font: "Inter", size: 0.05, maxChars: 24, dim: true, hl: "none", in: "fade" }],
  ["Контур", { ...P0, font: "Montserrat", size: 0.075, maxChars: 14, case: "upper", stroke: 0.16, shadow: 0, hl: "color", hlColor: "#ffd60a" }],
  ["Таблетка", { ...P0, font: "Inter", size: 0.055, maxChars: 18, color: "#000000", shadow: 0, bg: 1, bgColor: "#ffffff", bgRadius: 0.7, bgPad: 0.3, hl: "color", hlColor: "#ff375f", in: "pop" }],
  ["Кино", { ...P0, font: "Oswald", size: 0.06, maxChars: 26, case: "upper", ls: 0.18, hl: "none", in: "fade", inDur: 0.5, out: "fade", outDur: 0.3 }],
  ["Высокий", { ...P0, font: "Oswald", size: 0.075, maxChars: 12, case: "upper", sy: 1.8, sx: 0.85, hl: "color", hlColor: "#30d158", in: "wipeUp" }],
  ["Огонь", { ...P0, font: "Rubik", size: 0.08, maxChars: 12, case: "upper", color: "#ffd60a", color2: "#ff453a", glow: 0.5, glowColor: "#ff9f0a", shadow: 0, hl: "bounce", hlColor: "#ffffff", in: "stomp", inDur: 0.2 }],
  ["Мягкий", { ...P0, font: "Caveat", size: 0.095, maxChars: 20, color: "#ffffff", hl: "keep", hlColor: "#ffd9a8", in: "letters", inDur: 0.5, out: "fade" }],
  ["Субтитр", { ...P0, font: "Inter", size: 0.045, maxChars: 30, y: 0.86, hl: "none", in: "none", bg: 0.55, bgRadius: 0.15, shadow: 0 }],
  ["Волна", { ...P0, font: "Rubik", size: 0.075, maxChars: 14, color: "#40c8e0", color2: "#0a84ff", hl: "none", in: "letters", inDur: 0.5, loop: "wave" }],
];
const GAP = 0.6, TAIL = 0.35;   // пауза, после которой начинается новая строка; сколько строка держится после последнего слова
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const eo = (p) => 1 - Math.pow(1 - p, 3);
const back = (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
const bounce = (p) => { const n = 7.5625, d = 2.75; return p < 1 / d ? n * p * p : p < 2 / d ? n * (p -= 1.5 / d) * p + 0.75 : p < 2.5 / d ? n * (p -= 2.25 / d) * p + 0.9375 : n * (p -= 2.625 / d) * p + 0.984375; };

// Настройки с умолчаниями; понимает проекты, сделанные до расширения (anim, active, box, upper).
export function normStyle(style) {
  const s = { ...SUB_DEFAULT, ...(style || {}) }, o = style || {};
  if (o.anim && !o.hl) { s.hl = o.box ? "box" : o.anim === "highlight" ? "color" : o.anim === "pop" ? "pop" : "none"; s.reveal = o.anim === "reveal"; s.in = o.anim === "none" ? "none" : "pop"; s.inDur = 0.12; }
  if (o.active && !o.hlColor) s.hlColor = o.active;
  if (o.upper && !o.case) s.case = "upper";
  return s;
}
const show = (text, st) => { const s = st.punct ? text : text.replace(/[.,!?;:…«»"()—–]+/g, "").trim(); return st.case === "upper" ? s.toUpperCase() : st.case === "lower" ? s.toLowerCase() : s; };

// clips: клипы дорожки по порядку; words: { файл: [{ text, start, end, em?, br?, nb? }] } во времени исходника
// (em — ключевое слово, br — после слова новая строка, nb — после слова строку не рвать).
// Возвращает строки во времени ролика: [{ start, end, key, i0, i1, raw, words: [{ text, start, end, em }] }]
export function buildLines(clips, words, style) {
  const st = normStyle(style), lines = [];
  let at = 0;
  for (const c of clips) {
    const len = c.out - c.in, list = (words && words[c.media]) || [], from = lines.length;
    let cur = null, chars = 0;
    const close = () => { if (cur) { lines.push(cur); cur = null; } };
    list.forEach((w, i) => {
      const mid = (w.start + w.end) / 2;
      if (mid < c.in || mid >= c.out) return;
      const own = () => (w.ls ? normStyle({ ...style, ...w.ls }) : st);   // строка со своими настройками: они записаны у её первого слова
      let text = show(w.text, cur ? cur.eff : own());
      if (!text) return;
      const s = at + clamp(w.start - c.in, 0, len), e = at + clamp(w.end - c.in, 0, len);
      if (cur) {
        const last = list[cur.i1], prev = cur.words[cur.words.length - 1];
        if (last.br || (!last.nb && (w.ls || s - prev.end > GAP || chars + 1 + text.length > cur.eff.maxChars || /[.!?…]$/.test(last.text)))) close();
      }
      if (!cur) { const eff = own(); text = show(w.text, eff); if (!text) return; cur = { start: s, end: e, key: c.media, i0: i, i1: i, words: [], eff, style: w.ls || null }; chars = 0; }
      cur.words.push({ text, start: s, end: Math.max(e, s + 0.01), em: !!w.em, ...(w.ws ? { style: w.ws } : {}) }); cur.i1 = i; cur.end = Math.max(e, s + 0.01); chars += (chars ? 1 : 0) + text.length;
    });
    close();
    at += len;
    for (let k = from; k < lines.length; k++) lines[k].clipEnd = at;
  }
  lines.forEach((l, i) => {
    const next = lines[i + 1]; delete l.eff;
    l.end = Math.min(l.end + TAIL, next ? next.start : Infinity, l.clipEnd + TAIL);
    l.raw = ((words[l.key] || []).slice(l.i0, l.i1 + 1)).map((w) => w.text).join(" ");
    if (st.shift) { l.start += st.shift; l.end += st.shift; for (const w of l.words) { w.start += st.shift; w.end += st.shift; } }
  });
  return lines;
}

// Полоса кадра, в которую попадают субтитры (сборщик рисует и накладывает только её). Чётные числа.
export function band(W, H, style, lines, clouds) {
  let y0 = H, y1 = 0;
  for (const c0 of clouds || []) { const c = { ...CLOUD_DEFAULT, ...c0 }; y0 = Math.min(y0, (c.y - c.h / 2) * H - 2); y1 = Math.max(y1, (c.y + c.h / 2) * H + 2); }
  const seen = new Set();
  for (const ov of (lines || []).length ? [null, ...lines.map((l) => l.style).filter(Boolean)] : []) {
    if (seen.has(ov)) continue; seen.add(ov);
    const st = normStyle(ov ? { ...style, ...ov } : style);
    if (st.rot) return { y: 0, h: H };
    const px = st.size * W * Math.max(1, ...(lines || []).flatMap((l) => l.words.map((w) => (w.style?.size || st.size) / st.size)));
    const half = Math.max(px * st.lh * 2.2 + px * 3, st.cloud > 0 ? (px * st.lh * 1.5 + px * 0.9) * st.cloudSize * st.cloudTall * 1.1 : 0) * Math.max(1, st.sy);
    y0 = Math.min(y0, st.y * H - half); y1 = Math.max(y1, st.y * H + half);
  }
  const y = Math.floor(clamp(y0, 0, H) / 2) * 2, y2 = Math.ceil(clamp(y1, 0, H) / 2) * 2;
  return { y, h: Math.max(2, y2 - y) };
}

// Облако: мягкий овал-затемнение, отдельный объект ролика со своим местом и временем (не привязан к субтитрам).
export const CLOUD_DEFAULT = { x: 0.5, y: 0.72, w: 0.8, h: 0.16, a: 0.6, soft: 0.6, color: "#000000", fade: 0.25 };
export function drawClouds(ctx, W, H, t, clouds) {
  let any = false;
  for (const c0 of clouds || []) {
    if (t < c0.start || t >= c0.end) continue;
    const c = { ...CLOUD_DEFAULT, ...c0 };
    const k = c.fade > 0 ? clamp(Math.min(t - c.start, c.end - t) / c.fade, 0, 1) : 1, a = c.a * k;
    if (a <= 0.001) continue;
    ctx.save(); ctx.translate(c.x * W, c.y * H); ctx.scale(c.w * W / 2, c.h * H / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1), core = clamp(1 - c.soft, 0, 0.95) * 0.9;
    for (let n = 0; n <= 8; n++) { const u = n / 8; g.addColorStop(core + (1 - core) * u, rgba(c.color, a * Math.pow(Math.cos(u * Math.PI / 2), 2))); }
    if (core > 0) g.addColorStop(0, rgba(c.color, a));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    any = true;
  }
  return any;
}

function rgba(hex, a) {
  const n = parseInt((hex || "#000000").slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Нарисовать субтитры момента t (секунды ролика) на холсте W×H. Возвращает true, если что-то нарисовано.
export function drawSubs(ctx, W, H, t, lines, style) {
  const li = lines.findIndex((l) => t >= l.start && t < l.end);
  if (li < 0) return false;
  const line = lines[li], st = normStyle(line.style ? { ...style, ...line.style } : style), px = st.size * W, lh = px * st.lh, maxW = W * st.wrap / st.sx, sp = Math.max(0, px * 0.32 + (st.ls + st.ws) * px), ls = st.ls * px;
  const perChar = st.in === "letters" || st.in === "type" || st.loop === "wave" || ls !== 0;
  ctx.save();
  const fontOf = (w) => `${(w && w.style && w.style.size ? w.style.size * W : px)}px "${(w && w.style && w.style.font) || st.font}", sans-serif`;
  ctx.font = fontOf(null); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.lineJoin = "round"; ctx.lineCap = "round";

  // ——— раскладка: слова по рядам, буквы внутри слов
  const rows = [[]]; let rw = 0, gi = 0;
  line.words.forEach((w, wi) => {
    let width, chars = null;
    const font = fontOf(w); ctx.font = font;   // у слова может быть свой шрифт и размер
    if (perChar) {
      chars = []; let prev = 0;
      const arr = [...w.text];
      arr.forEach((ch, i) => { const adv = ctx.measureText(arr.slice(0, i + 1).join("")).width; chars.push({ ch, x: prev + i * ls, w: adv - prev, gi: gi++ }); prev = adv; });
      width = prev + Math.max(0, arr.length - 1) * ls;
    } else { width = ctx.measureText(w.text).width; gi += w.text.length; }
    if (rows[rows.length - 1].length && rw + sp + width > maxW) { rows.push([]); rw = 0; }
    const row = rows[rows.length - 1];
    const x = rw + (row.length ? sp : 0);
    row.push({ w, wi, width, x, chars, font, px: w.style && w.style.size ? w.style.size * W : px }); rw = x + width; row.width = rw;
  });
  const nChars = Math.max(1, gi), nWords = line.words.length;
  const blockW = Math.max(...rows.map((r) => r.width)), blockH = rows.length * lh;
  const X = st.x * W, cy = st.y * H, top = cy - blockH / 2, left = X - blockW / 2;
  rows.forEach((row, r) => { row.x0 = st.align === "left" ? left : st.align === "right" ? left + blockW - row.width : X - row.width / 2; row.base = top + r * lh + (lh - px) / 2 + px * 0.82; });

  // ——— движение всей строки: появление, исчезание, постоянное
  const tau = t - line.start;
  const F = { a: st.opacity, dx: 0, dy: 0, sx: 1, sy: 1, r: st.rot * Math.PI / 180, clip: null };
  const fx = (kind, p, dir) => {      // p: 0 — не видно, 1 — на месте; dir: +1 появление, −1 исчезание
    const e = eo(p);
    switch (kind) {
      case "fade": F.a *= p; break;
      case "pop": { const s = dir > 0 ? back(p) : e; F.sx *= s; F.sy *= s; F.a *= Math.min(1, p * 3); break; }
      case "zoom": { const s = 1.6 - 0.6 * e; F.sx *= s; F.sy *= s; F.a *= p; break; }
      case "up": F.dy += dir * (1 - e) * px * 0.8; F.a *= p; break;
      case "down": F.dy -= dir * (1 - e) * px * 0.8; F.a *= p; break;
      case "left": F.dx -= dir * (1 - e) * px * 1.6; F.a *= p; break;
      case "right": F.dx += dir * (1 - e) * px * 1.6; F.a *= p; break;
      case "drop": F.dy -= (1 - bounce(p)) * px * 1.6; F.a *= Math.min(1, p * 4); break;
      case "stomp": { const s = p < 0.7 ? 2.4 - 1.5 * (p / 0.7) : 0.9 + 0.1 * ((p - 0.7) / 0.3); F.sx *= s; F.sy *= s; F.a *= Math.min(1, p * 5); break; }
      case "spring": { const k = 1 + 0.5 * Math.cos(p * Math.PI * 3) * (1 - p); F.sy *= k; F.sx *= 2 - k; F.a *= Math.min(1, p * 4); break; }
      case "spin": F.r += (1 - e) * -0.4; F.sx *= 0.5 + 0.5 * e; F.sy *= 0.5 + 0.5 * e; F.a *= p; break;
      case "flip": F.sy *= Math.max(0.001, e); break;
      case "wipe": F.clip = dir > 0 ? [0, 0, e, 1] : [1 - e, 0, 1, 1]; break;
      case "wipeUp": F.clip = [0, 1 - e, 1, 1]; break;
      case "wipeC": F.clip = [0.5 - 0.5 * e, 0, 0.5 + 0.5 * e, 1]; break;
    }
  };
  if (st.in !== "none") fx(st.in, clamp(tau / Math.max(0.01, st.inDur), 0, 1), 1);
  if (st.out !== "none") { const q = clamp((line.end - t) / Math.max(0.01, st.outDur), 0, 1); if (q < 1) fx(st.out, q, -1); }
  if (st.loop === "pulse") { const s = 1 + 0.05 * Math.sin(tau * 10); F.sx *= s; F.sy *= s; }
  else if (st.loop === "shake") { F.dx += px * 0.04 * Math.sin(tau * 47); F.dy += px * 0.04 * Math.sin(tau * 61 + 1); }
  else if (st.loop === "swing") F.r += 0.05 * Math.sin(tau * 4);
  else if (st.loop === "float") F.dy += px * 0.1 * Math.sin(tau * 3);
  if (F.a <= 0.001) { ctx.restore(); return true; }
  ctx.translate(X + F.dx, cy + F.dy); ctx.rotate(F.r); ctx.scale(F.sx * st.sx, F.sy * st.sy); ctx.translate(-X, -cy);   // sx, sy — ширина и высота букв
  ctx.globalAlpha = clamp(F.a, 0, 1);
  // ——— облако: мягкое овальное затемнение под текстом (рисуется до «шторок», чтобы они его не обрезали)
  if (st.cloud > 0) {
    const rx = (blockW / 2 + px * 1.2) * st.cloudSize, ry = (blockH / 2 + px * 0.9) * st.cloudSize * st.cloudTall;
    ctx.save(); ctx.translate(X, cy); ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1), core = clamp(1 - st.cloudSoft, 0, 0.95) * 0.9;
    for (let n = 0; n <= 8; n++) { const u = n / 8, r = core + (1 - core) * u; g.addColorStop(r, rgba(st.cloudColor, st.cloud * Math.pow(Math.cos(u * Math.PI / 2), 2))); }
    if (core > 0) g.addColorStop(0, rgba(st.cloudColor, st.cloud));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (F.clip) {
    const m = px * 0.6, bx = left - m, by = top - m, bw = blockW + 2 * m, bh = blockH + 2 * m;
    ctx.beginPath(); ctx.rect(bx + bw * F.clip[0], by + bh * F.clip[1], bw * (F.clip[2] - F.clip[0]), bh * (F.clip[3] - F.clip[1])); ctx.clip();
  }
  const rr = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2)); else ctx.rect(x, y, w, h); ctx.fill(); };

  // ——— фон под рядами
  if (st.bg > 0) {
    ctx.fillStyle = rgba(st.bgColor, st.bg);
    const pad = st.bgPad * px;
    for (const row of rows) rr(row.x0 - pad * 1.4, row.base - px * 0.86 - pad, row.width + pad * 2.8, px * 1.1 + pad * 2, st.bgRadius * px);
  }

  // ——— что рисовать: слова или буквы, каждая со своим движением и цветом
  const ops = [];
  for (const row of rows) for (const it of row) {
    const w = it.w, next = line.words[it.wi + 1], spoken = t >= w.start, active = spoken && t < (next ? next.start : line.end);
    if (st.reveal && !spoken) continue;
    const ws = w.style || {};
    let fill = ws.color || st.color, scale = 1, alpha = 1, sweep = null, lift = 0, glowing = false;
    if (w.em && !ws.color) { fill = st.emColor; scale = 1.1; }
    if (st.dim && !spoken) alpha = 0.4;
    const x = row.x0 + it.x, mx = x + it.width / 2, my = row.base - px * 0.34;
    if (active) {
      if (st.hl === "color" || st.hl === "pop" || st.hl === "bounce") fill = st.hlColor;
      if (st.hl === "bounce") lift = -px * 0.28 * Math.sin(clamp((t - w.start) / 0.22, 0, 1) * Math.PI);
      if (st.hl === "glow") glowing = true;
      if (st.hl === "pop") scale *= 1 + 0.14 * Math.sin(clamp((t - w.start) / 0.1, 0, 1) * Math.PI / 2);
      if (st.hl === "box") { ctx.fillStyle = st.hlColor; rr(x - px * 0.2, row.base - px * 0.9 - px * 0.08, it.width + px * 0.4, px * 1.12 + px * 0.16, px * 0.22); }
      if (st.hl === "under") { ctx.fillStyle = st.hlColor; rr(x, row.base + px * 0.14, it.width * clamp((t - w.start) / 0.12, 0, 1), px * 0.1, px * 0.05); }
      if (st.hl === "fill") sweep = clamp((t - w.start) / Math.max(0.05, (next ? next.start : w.end) - w.start), 0, 1);
    }
    if ((st.hl === "keep" && spoken) || (st.hl === "fill" && spoken && !active)) fill = st.hlColor;
    if (st.in === "words") { const p = clamp((tau - it.wi * st.inDur * 0.6 / nWords) / (st.inDur * 0.5), 0, 1); scale *= Math.max(0.001, back(p)); alpha *= Math.min(1, p * 3); }
    const units = it.chars ? it.chars.map((c) => ({ text: c.ch, x: x + c.x, gi: c.gi })) : [{ text: w.text, x, gi: 0 }];
    for (const u of units) {
      let a = alpha, dy = lift;
      if (it.chars) {
        if (st.in === "type" && u.gi >= clamp(tau / Math.max(0.01, st.inDur), 0, 1) * nChars) continue;
        if (st.in === "letters") { const p = clamp((tau - u.gi * st.inDur * 0.6 / nChars) / (st.inDur * 0.4), 0, 1); a *= p; dy += (1 - eo(p)) * px * 0.6; }
        if (st.loop === "wave") dy += px * 0.1 * Math.sin(tau * 6 - u.gi * 0.6);
      }
      if (a > 0.001) ops.push({ text: u.text, x: u.x, base: row.base + dy, mx, my: my + dy, scale, a, fill, sweep, wx: x, ww: it.width, font: it.font, px: it.px, glowing,
        own: !!ws.color, c2: ws.color ? ws.color2 || "" : st.color2, sc: ws.strokeColor || st.strokeColor, it: ws.italic ?? st.italic });
    }
  }
  const each = (fn) => { for (const o of ops) { ctx.save(); ctx.globalAlpha *= o.a; ctx.translate(o.mx, o.my); ctx.scale(o.scale, o.scale); if (o.it) ctx.transform(1, 0, -0.2, 1, 0, 0); ctx.translate(-o.mx, -o.my); ctx.font = o.font; fn(o); ctx.restore(); } };

  // ——— свечение, тень, обводка — под всеми буквами
  each((o) => { if (o.glowing) { ctx.shadowColor = st.hlColor; ctx.shadowBlur = px * 0.5; ctx.fillStyle = st.hlColor; ctx.fillText(o.text, o.x, o.base); ctx.fillText(o.text, o.x, o.base); } });
  if (st.glow > 0) each((o) => { ctx.shadowColor = st.glowColor; ctx.shadowBlur = st.glow * px * 0.7; ctx.fillStyle = st.glowColor; ctx.fillText(o.text, o.x, o.base); ctx.fillText(o.text, o.x, o.base); });
  if (st.shadow > 0) each((o) => {
    ctx.shadowColor = rgba(st.shadowColor, 0.85); ctx.shadowBlur = st.shadowBlur * px * 0.4; ctx.shadowOffsetX = st.shadow * px * 0.1; ctx.shadowOffsetY = st.shadow * px * 0.1;
    if (st.stroke > 0) { ctx.strokeStyle = o.sc; ctx.lineWidth = st.stroke * o.px; ctx.strokeText(o.text, o.x, o.base); } else { ctx.fillStyle = st.shadowColor; ctx.fillText(o.text, o.x, o.base); }
  });
  if (st.stroke > 0) each((o) => { ctx.strokeStyle = o.sc; ctx.lineWidth = st.stroke * o.px; ctx.strokeText(o.text, o.x, o.base); });
  // ——— сами буквы
  each((o) => {
    if (o.c2 && (o.own || o.fill === st.color)) { const g = ctx.createLinearGradient(0, o.base - o.px * 0.8, 0, o.base + o.px * 0.1); g.addColorStop(0, o.fill); g.addColorStop(1, o.c2); ctx.fillStyle = g; }
    else ctx.fillStyle = o.fill;
    ctx.fillText(o.text, o.x, o.base);
    if (o.sweep != null) { ctx.beginPath(); ctx.rect(o.wx - px * 0.1, o.base - px * 1.1, (o.ww + px * 0.2) * o.sweep, px * 1.6); ctx.clip(); ctx.fillStyle = st.hlColor; ctx.fillText(o.text, o.x, o.base); }
  });
  ctx.restore();
  return true;
}
