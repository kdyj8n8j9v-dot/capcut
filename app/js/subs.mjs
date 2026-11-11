// Субтитры: разбивка слов на строки и отрисовка. Один и тот же код рисует превью в приложении
// и готовое видео на сборщике (worker/subs.mjs) — поэтому превью совпадает с итогом. Здесь нет ничего от браузера.
export const FONTS = { Montserrat: "Montserrat_800ExtraBold.ttf", Inter: "Inter_800ExtraBold.ttf", Rubik: "Rubik_800ExtraBold.ttf", Oswald: "Oswald_600SemiBold.ttf", Caveat: "Caveat_700Bold.ttf" };
export const SUB_DEFAULT = { font: "Montserrat", size: 0.07, y: 0.72, color: "#ffffff", active: "#ffd60a", stroke: 0.14, box: false, anim: "highlight", upper: false, punct: true, maxChars: 16 };
export const PRESETS = [
  ["Классика", { font: "Inter", anim: "none", color: "#ffffff", active: "#ffffff", stroke: 0.14, box: false, upper: false, maxChars: 22, size: 0.06 }],
  ["Караоке", { font: "Montserrat", anim: "highlight", color: "#ffffff", active: "#ffd60a", stroke: 0.14, box: false, upper: false, maxChars: 16, size: 0.07 }],
  ["Прыжок", { font: "Montserrat", anim: "pop", color: "#ffffff", active: "#30d158", stroke: 0.16, box: false, upper: true, maxChars: 14, size: 0.075 }],
  ["Плашка", { font: "Rubik", anim: "highlight", color: "#ffffff", active: "#0a84ff", stroke: 0, box: true, upper: false, maxChars: 16, size: 0.065 }],
  ["По слову", { font: "Oswald", anim: "reveal", color: "#ffffff", active: "#ffffff", stroke: 0.14, box: false, upper: true, maxChars: 16, size: 0.085 }],
  ["Одно слово", { font: "Montserrat", anim: "pop", color: "#ffffff", active: "#ffd60a", stroke: 0.16, box: false, upper: true, maxChars: 1, size: 0.11 }],
];
const GAP = 0.6, TAIL = 0.35;   // пауза, после которой начинается новая строка; сколько строка держится после последнего слова
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const show = (text, st) => { let s = st.punct ? text : text.replace(/[.,!?;:…«»"()—–]+/g, "").trim(); return st.upper ? s.toUpperCase() : s; };

// clips: клипы дорожки по порядку; words: { файл: [{ text, start, end }] } во времени исходника.
// Возвращает строки во времени ролика: [{ start, end, key, i0, i1, raw, words: [{ text, start, end }] }]
export function buildLines(clips, words, style) {
  const st = { ...SUB_DEFAULT, ...style }, lines = [];
  let at = 0;
  for (const c of clips) {
    const len = c.out - c.in, list = (words && words[c.media]) || [];
    let cur = null, chars = 0;
    const close = () => { if (cur) { lines.push(cur); cur = null; } };
    list.forEach((w, i) => {
      const mid = (w.start + w.end) / 2;
      if (mid < c.in || mid >= c.out) return;
      const text = show(w.text, st);
      if (!text) return;
      const s = at + clamp(w.start - c.in, 0, len), e = at + clamp(w.end - c.in, 0, len);
      const prev = cur && cur.words[cur.words.length - 1];
      if (cur && (s - prev.end > GAP || chars + 1 + text.length > st.maxChars || /[.!?…]$/.test(list[cur.i1].text))) close();
      if (!cur) { cur = { start: s, end: e, key: c.media, i0: i, i1: i, words: [] }; chars = 0; }
      cur.words.push({ text, start: s, end: Math.max(e, s + 0.01) }); cur.i1 = i; cur.end = e; chars += (chars ? 1 : 0) + text.length;
    });
    close();
    at += len;
    for (const l of lines) if (l.key === c.media && l.end > at) l.end = at;
  }
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    l.end = Math.min(l.end + TAIL, next ? next.start : Infinity);
    l.raw = ((words[l.key] || []).slice(l.i0, l.i1 + 1)).map((w) => w.text).join(" ");
  });
  return lines;
}

// Полоса кадра, в которую попадают субтитры (сборщик рисует и накладывает только её). Чётные числа.
export function band(W, H, style) {
  const st = { ...SUB_DEFAULT, ...style }, half = st.size * W * 1.25 * 2.2 + st.size * W;
  const y = Math.floor(clamp(st.y * H - half, 0, H) / 2) * 2, y2 = Math.ceil(clamp(st.y * H + half, 0, H) / 2) * 2;
  return { y, h: Math.max(2, y2 - y) };
}

// Нарисовать субтитры момента t (секунды ролика) на холсте W×H. Возвращает true, если что-то нарисовано.
export function drawSubs(ctx, W, H, t, lines, style) {
  const st = { ...SUB_DEFAULT, ...style };
  const line = lines.find((l) => t >= l.start && t < l.end);
  if (!line) return false;
  const px = st.size * W, lh = px * 1.25, maxW = W * 0.88;
  ctx.save();
  ctx.font = `${px}px "${st.font}", sans-serif`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.lineJoin = "round";
  const space = px * 0.28;   // своё число, а не ширина пробела шрифта: одинаково в браузере и на сборщике
  const rows = [[]]; let rw = 0;
  for (const w of line.words) {
    const width = ctx.measureText(w.text).width;
    if (rows[rows.length - 1].length && rw + space + width > maxW) { rows.push([]); rw = 0; }
    const row = rows[rows.length - 1];
    row.push({ w, width, x: rw + (row.length ? space : 0) }); rw += (row.length > 1 ? space : 0) + width; row.width = rw;
  }
  const k = st.anim === "none" ? 1 : clamp((t - line.start) / 0.12, 0, 1), ease = 1 - (1 - k) * (1 - k);
  const cy = st.y * H, top = cy - rows.length * lh / 2;
  ctx.translate(W / 2, cy); ctx.scale(0.92 + 0.08 * ease, 0.92 + 0.08 * ease); ctx.translate(-W / 2, -cy);
  ctx.globalAlpha = ease;
  rows.forEach((row, r) => {
    const x0 = (W - row.width) / 2, base = top + r * lh + px * 0.92;
    for (const it of row) {
      const i = line.words.indexOf(it.w), next = line.words[i + 1];
      const active = t >= it.w.start && t < (next ? next.start : line.end);
      if (st.anim === "reveal" && t < it.w.start) continue;
      const lit = active && st.anim !== "none";
      const x = x0 + it.x, mx = x + it.width / 2, my = base - px * 0.36;
      ctx.save();
      if (st.anim === "pop" && active) { const s = 1 + 0.14 * Math.sin(clamp((t - it.w.start) / 0.1, 0, 1) * Math.PI / 2); ctx.translate(mx, my); ctx.scale(s, s); ctx.translate(-mx, -my); }
      if (st.box && lit) {
        const padX = px * 0.2, padY = px * 0.1; ctx.fillStyle = st.active; ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - padX, base - px * 0.9 - padY, it.width + 2 * padX, px * 1.12 + 2 * padY, px * 0.22); else ctx.rect(x - padX, base - px * 0.9 - padY, it.width + 2 * padX, px * 1.12 + 2 * padY);
        ctx.fill();
      }
      if (st.stroke > 0) { ctx.strokeStyle = "#000000"; ctx.lineWidth = st.stroke * px; ctx.strokeText(it.w.text, x, base); }
      else if (!(st.box && lit)) { ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = px * 0.12; ctx.shadowOffsetY = px * 0.04; }
      ctx.fillStyle = lit && !st.box ? st.active : st.color;
      ctx.fillText(it.w.text, x, base);
      ctx.restore();
    }
  });
  ctx.restore();
  return true;
}
