// Панель «Субтитры»: шаблоны, текст, шрифт, цвет, анимация; редактор одной строки; палитра цветов.
import { h, icon, sheet, toast, askText, ask, fmtTime, clamp } from "./ui.js";
import { settings } from "./store.js";
import { cloud } from "./cloud.js";
import { FONTS, SUB_DEFAULT, PRESETS, ANIM_IN, ANIM_OUT, ANIM_LOOP, HL, drawSubs } from "./subs.mjs";
import { packFonts, useFont, fontReady, haveLocal } from "./fonts.js";

// ——— цвет: #rrggbb ↔ тон, насыщенность, яркость
function toHsv(hex) {
  const n = parseInt((hex || "#ffffff").slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, mx ? d / mx : 0, mx];
}
function toHex(hh, s, v) {
  const f = (n) => { const k = (n + hh / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, "0"); };
  return "#" + f(5) + f(3) + f(1);
}
const QUICK = ["#ffffff", "#000000", "#ffd60a", "#ff9f0a", "#ff453a", "#ff375f", "#bf5af2", "#5e5ce6", "#0a84ff", "#40c8e0", "#30d158", "#a2845e"];
// Палитра: быстрые цвета, недавние, поле «насыщенность × яркость», полоса тона, код цвета.
export function colorPicker(get, set, begin) {
  let [hue, sat, val] = toHsv(get());
  const sq = h("div.cp-sq"), dot = h("i"), hueIn = h("input.cp-hue", { type: "range", min: 0, max: 359, step: 1, "aria-label": "Тон" });
  const hex = h("input.field.cp-hex", { maxLength: 7, "aria-label": "Код цвета", autocapitalize: "off", spellcheck: false });
  const quick = h("div.cp-quick");
  sq.append(dot);
  const paint = (fromHex) => {
    sq.style.background = `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hue},100%,50%))`;
    dot.style.left = sat * 100 + "%"; dot.style.top = (1 - val) * 100 + "%"; dot.style.background = toHex(hue, sat, val);
    hueIn.value = hue; if (!fromHex) hex.value = toHex(hue, sat, val).toUpperCase();
    const recent = settings.get("colors") || [];
    quick.replaceChildren(...[...QUICK, ...recent.filter((c) => !QUICK.includes(c)).slice(0, 6)].map((c) => h("button" + (c === get() ? ".on" : ""), { style: { background: c }, "aria-label": "Цвет " + c, onclick: () => { begin(); [hue, sat, val] = toHsv(c); set(c); paint(); } })));
  };
  const remember = () => { const c = get(); if (!QUICK.includes(c)) settings.set("colors", [c, ...(settings.get("colors") || []).filter((x) => x !== c)].slice(0, 6)); };
  const pick = (e) => { const r = sq.getBoundingClientRect(); sat = clamp((e.clientX - r.left) / r.width, 0, 1); val = 1 - clamp((e.clientY - r.top) / r.height, 0, 1); set(toHex(hue, sat, val)); paint(); };
  sq.addEventListener("pointerdown", (e) => { begin(); sq.setPointerCapture(e.pointerId); pick(e); });
  sq.addEventListener("pointermove", (e) => { if (sq.hasPointerCapture(e.pointerId)) pick(e); });
  sq.addEventListener("pointerup", () => { remember(); paint(); });
  hueIn.addEventListener("pointerdown", begin);
  hueIn.addEventListener("input", () => { hue = +hueIn.value; if (sat < 0.05) sat = 1; if (val < 0.05) val = 1; set(toHex(hue, sat, val)); paint(); });
  hueIn.addEventListener("change", () => { remember(); paint(); });
  hex.addEventListener("change", () => { let v = hex.value.trim(); if (!v.startsWith("#")) v = "#" + v; if (/^#[0-9a-f]{6}$/i.test(v)) { begin(); [hue, sat, val] = toHsv(v); set(v.toLowerCase()); remember(); paint(true); } else paint(); });
  paint();
  return h("div.cp", {}, quick, sq, h("div.cp-row", {}, hueIn, hex));
}

let tab = 0, colorTab = 0, animTab = 0, fontQuery = "", packList = null, packLocal = new Set(), packErr = "";

// api: { P, cur, st, lines, change(fn), live(), begin, slider, head, rerender, seek, playLine, makeSubs, making, toastErr }
export function subsPanel(api) {
  const { P, change, live, begin, slider, head, rerender } = api, cur = api.cur(), st = api.st;
  const lines = api.lines();
  const sl = (label, key, min, max, show, step) => slider(label, () => api.cur()[key], (v) => { st()[key] = v; live(); }, { min, max, step, def: SUB_DEFAULT[key], show });
  const pct = (v) => Math.round(v * 100), sec = (v) => v.toFixed(2).replace(".", ",") + " с";
  const seg = (items, on, pick, scroll = true) => h("div.seg" + (scroll ? ".scroll" : ""), {}, items.map(([k, n]) => h("button" + (on === k ? ".on" : ""), { onclick: () => pick(k) }, n)));
  const picker = (key) => colorPicker(() => api.cur()[key] || "#ffffff", (c) => { st()[key] = c; live(); }, begin);
  const toggle = (label, key) => h("button.check" + (cur[key] ? ".on" : ""), { onclick: () => change(() => st()[key] = !cur[key]) }, h("i", {}, cur[key] ? icon("check", 14) : null), label);
  const tiles = (list, on, pick) => h("div.tiles", {}, list.map(([k, n]) => h("button" + (on === k ? ".on" : ""), { onclick: () => pick(k) }, n)));
  let body;

  if (tab === 0) {            // ——— стили
    const mine = settings.get("subStyles") || [];
    const keep = () => ({ x: cur.x, y: cur.y, rot: cur.rot, shift: cur.shift });
    const apply = (v) => { useFont(v.font).catch(() => {}); change(() => { P.subs.style = { ...v, ...keep() }; }); api.playLine(); };
    const same = (v) => Object.keys(v).every((k) => ["x", "y", "rot", "shift"].includes(k) || cur[k] === v[k]);
    const tile = (name, v, del) => {
      const cv = h("canvas", { width: 320, height: 120 });
      const paint = () => { const c = cv.getContext("2d"); c.clearRect(0, 0, 320, 120); drawSubs(c, 320, 120, 0.3, [{ start: 0, end: 9, words: [{ text: name.split(" ")[0], start: 0, end: 0.2 }, ...(name.includes(" ") ? [{ text: name.split(" ").slice(1).join(" "), start: 0.2, end: 9 }] : [])] }], { ...v, size: Math.min(0.15, 1.5 / Math.max(6, name.length)), x: 0.5, y: 0.5, rot: 0, in: "none", out: "none", loop: "none", reveal: false, maxChars: 99 }); };
      paint(); useFont(v.font).then(paint).catch(() => {});
      return h("button" + (same(v) ? ".on" : ""), { onclick: () => apply(v), "aria-label": name }, cv, del && h("span.x", { onclick: (e) => { e.stopPropagation(); del(); } }, icon("close", 12)));
    };
    body = [h("div.presets", {}, PRESETS.map(([name, v]) => tile(name, v))),
      h("div.sec", {}, h("span", {}, "Мои стили"), h("button.link", { onclick: async () => {
        const name = await askText("Название стиля", "Мой стиль " + (mine.length + 1));
        if (name) { const v = { ...cur }; for (const k of ["x", "y", "rot", "shift"]) delete v[k]; settings.set("subStyles", [...mine, { name, style: v }]); rerender(); toast("Стиль сохранён"); }
      } }, "Сохранить текущий")),
      mine.length ? h("div.presets", {}, mine.map((m, i) => tile(m.name, m.style, async () => { if (await ask("Удалить стиль?", `«${m.name}»`)) { settings.set("subStyles", mine.filter((_, k) => k !== i)); rerender(); } })))
        : h("p.hint", {}, "Настройте вид как нравится и сохраните — стиль появится здесь и в других проектах.")];
  } else if (tab === 1) {     // ——— текст
    body = [h("p.hint", {}, "Нажмите на строку: поправить текст, выделить слово, разделить или склеить."),
      h("div.list", {}, lines.length ? lines.map((l, i) => h("button.item.line", { onclick: () => { api.seek(l.start + 0.02); openLine(api, i); } },
        h("small", {}, fmtTime(l.start, true)), h("span.item-main", {}, l.words.map((w) => h("span" + (w.em ? ".em" : ""), { style: w.em ? { color: cur.emColor } : {} }, w.text + " "))))) : h("p.muted", {}, "В ролике нет распознанной речи.")),
      sl("Букв в строке", "maxChars", 1, 40, (v) => Math.round(v), 1),
      seg([["none", "Как есть"], ["upper", "ЗАГЛАВНЫЕ"], ["lower", "строчные"]], cur.case, (k) => change(() => st().case = k), false),
      toggle("Знаки препинания", "punct"),
      sl("Сдвиг по времени", "shift", -0.5, 0.5, (v) => (v > 0 ? "+" : "") + sec(v)),
      h("button.btn.wide", { onclick: api.makeSubs, disabled: api.making }, "Распознать речь заново")];
  } else if (tab === 2) {     // ——— шрифт
    const setFont = async (name) => { try { api.busy(true); await useFont(name); packLocal.add(name); change(() => st().font = name); } catch (e) { toast(e.message, 5000); rerender(); } finally { api.busy(false); } };
    const loadPack = async (refresh) => { packErr = ""; try { packList = await packFonts(refresh); packLocal = await haveLocal(); } catch (e) { packErr = e.message; packList = packList || []; } rerender(); };
    if (!packList && !packErr && cloud.signedIn()) loadPack(false);
    const q = fontQuery.trim().toLowerCase(), shown = (packList || []).filter((f) => !q || f.name.toLowerCase().includes(q));
    for (const f of shown.slice(0, 60)) if (packLocal.has(f.name) && !fontReady(f.name)) useFont(f.name).then(rerender).catch(() => {});
    body = [
      h("div.fonts", {}, Object.keys(FONTS).map((f) => h("button" + (cur.font === f ? ".on" : ""), { style: { fontFamily: `"${f}"` }, onclick: () => setFont(f) }, f))),
      h("div.sec", {}, h("span", {}, "Мои шрифты · MEGA"), h("button.link", { onclick: () => { packList = null; rerender(); loadPack(true); } }, "Обновить")),
      !cloud.signedIn() ? h("p.hint", {}, "Войдите в MEGA в «Настройках» — здесь появятся шрифты из папки «Для монтажа ПАК».")
        : packErr ? h("p.hint", {}, packErr) : !packList ? h("p.hint", {}, "Ищу шрифты в «Для монтажа ПАК»…")
        : !packList.length ? h("p.hint", {}, "В «Для монтажа ПАК» не нашлось файлов шрифтов (.ttf, .otf).")
        : [packList.length > 8 && h("input.field", { placeholder: `Поиск среди ${packList.length} шрифтов`, value: fontQuery, oninput: (e) => { fontQuery = e.target.value; clearTimeout(subsPanel.t); subsPanel.t = setTimeout(() => { rerender(); const i = document.querySelector(".panel input.field"); if (i) { i.focus(); i.setSelectionRange(99, 99); } }, 350); } }),
          h("div.fonts", {}, shown.slice(0, 60).map((f) => h("button" + (cur.font === f.name ? ".on" : "") + (packLocal.has(f.name) ? "" : ".cloud"), { style: fontReady(f.name) ? { fontFamily: `"${f.name}"` } : {}, onclick: () => setFont(f.name) }, f.name))),
          shown.length > 60 && h("p.hint", {}, `Показаны первые 60 из ${shown.length}. Уточните поиск.`),
          h("p.hint", {}, "Серые ещё не скачаны: нажмите — шрифт загрузится и применится. Если вместо русских букв другой шрифт, значит в этом шрифте нет кириллицы.")],
      sl("Размер", "size", 0.025, 0.2, (v) => Math.round(v * 1000)),
      sl("Ширина букв", "sx", 0.4, 2.5, pct), sl("Высота букв", "sy", 0.4, 3, pct),
      sl("Между буквами", "ls", -0.08, 0.6, pct), sl("Между словами", "ws", -0.25, 1.5, pct), sl("Между строками", "lh", 0.7, 3, pct),
      sl("Ширина текста на экране", "wrap", 0.3, 1, pct),
      seg([["left", "Влево"], ["center", "По центру"], ["right", "Вправо"]], cur.align, (k) => change(() => st().align = k), false),
      toggle("Наклон (курсив)", "italic"),
      h("p.hint", {}, "Положение: двигайте субтитры пальцем прямо на видео, двумя пальцами — размер."),
      sl("Высота на экране", "y", 0.05, 0.95, (v) => Math.round((1 - v) * 100)), sl("Поворот", "rot", -45, 45, (v) => Math.round(v) + "°", 1),
      h("button.btn.wide", { onclick: () => change(() => Object.assign(st(), { x: 0.5, rot: 0 })) }, "Поставить по центру")];
  } else if (tab === 3) {     // ——— цвет
    const parts = [["text", "Текст"], ["stroke", "Обводка"], ["bg", "Фон"], ["shadow", "Тень"], ["glow", "Свечение"]];
    const k = parts[colorTab][0];
    body = [seg(parts, k, (x) => { colorTab = parts.findIndex((p) => p[0] === x); rerender(); }),
      k === "text" ? [picker("color"), h("button.check" + (cur.color2 ? ".on" : ""), { onclick: () => change(() => st().color2 = cur.color2 ? "" : "#ff375f") }, h("i", {}, cur.color2 ? icon("check", 14) : null), "Градиент (второй цвет снизу)"), cur.color2 && picker("color2"), sl("Непрозрачность", "opacity", 0.1, 1, pct)]
      : k === "stroke" ? [sl("Толщина", "stroke", 0, 0.4, pct), cur.stroke > 0 && picker("strokeColor")]
      : k === "bg" ? [sl("Плотность фона", "bg", 0, 1, pct), cur.bg > 0 && [picker("bgColor"), sl("Скругление", "bgRadius", 0, 0.7, pct), sl("Отступ", "bgPad", 0, 0.6, pct)]]
      : k === "shadow" ? [sl("Сила тени", "shadow", 0, 1, pct), cur.shadow > 0 && [sl("Размытие", "shadowBlur", 0, 1, pct), picker("shadowColor")]]
      : [sl("Сила свечения", "glow", 0, 1, pct), cur.glow > 0 && picker("glowColor")]];
  } else {                    // ——— анимация
    const parts = [["in", "Появление"], ["out", "Исчезание"], ["loop", "В кадре"], ["hl", "Слова"]];
    const k = parts[animTab][0], pick = (key) => (v) => { change(() => st()[key] = v); api.playLine(); };
    body = [seg(parts, k, (x) => { animTab = parts.findIndex((p) => p[0] === x); rerender(); }),
      k === "in" ? [tiles(ANIM_IN, cur.in, pick("in")), cur.in !== "none" && sl("Длительность", "inDur", 0.05, 1.5, sec)]
      : k === "out" ? [tiles(ANIM_OUT, cur.out, pick("out")), cur.out !== "none" && sl("Длительность", "outDur", 0.05, 1.5, sec)]
      : k === "loop" ? [tiles(ANIM_LOOP, cur.loop, pick("loop")), h("p.hint", {}, "Движение, которое идёт всё время, пока строка на экране.")]
      : [h("p.hint", {}, "Как выделяется слово, которое сейчас звучит."), tiles(HL, cur.hl, pick("hl")),
        cur.hl !== "none" && [h("div.sl-top", {}, "Цвет звучащего слова"), picker("hlColor")],
        toggle("Слова появляются по одному", "reveal"), toggle("Ещё не сказанные — бледные", "dim"),
        h("div.sl-top", {}, "Цвет ключевых слов"), h("p.hint", {}, "Ключевое слово отмечается в строке: вкладка «Текст» → нажать на строку → нажать на слово."), picker("emColor")]];
  }
  const TABS = ["Стили", "Текст", "Шрифт", "Цвет", "Анимация"];
  return [head("Субтитры"),
    h("div.seg.scroll.tabs", {}, TABS.map((n, i) => h("button" + (i === tab ? ".on" : ""), { onclick: () => { tab = i; rerender(); } }, n))),
    h("div.sliders", {}, body),
    h("button.btn.wide", { onclick: () => change(() => P.subs.on = !P.subs.on) }, P.subs.on ? "Скрыть субтитры" : "Показать субтитры")];
}
export const openSubsTab = (i) => { tab = i; };

// Редактор одной строки: текст, ключевые слова, разделить, склеить, время, удалить.
export function openLine(api, index) {
  const { P, change } = api;
  let s;
  const render = () => {
    const l = api.lines()[index];
    if (!l) return s && s.close();
    const src = P.words[l.key], n = l.i1 - l.i0 + 1, next = api.lines()[index + 1];
    const canJoin = next && next.key === l.key && next.i0 === l.i1 + 1;
    const inp = h("input.field", { value: l.raw, "aria-label": "Текст строки", onkeydown: (e) => { if (e.key === "Enter") applyText(); } });
    const applyText = () => {
      const txt = inp.value.trim();
      if (txt === l.raw) return false;
      const a = src[l.i0].start, b = src[l.i1].end, parts = txt.split(/\s+/).filter(Boolean);
      change(() => src.splice(l.i0, n, ...(parts.length === n ? parts.map((x, k) => ({ ...src[l.i0 + k], text: x }))
        : parts.map((x, k) => ({ text: x, start: a + (b - a) * k / parts.length, end: a + (b - a) * (k + 1) / parts.length })))));
      return true;
    };
    const nudge = (which, d) => change(() => { const w = which ? src[l.i1] : src[l.i0]; if (which) w.end = Math.max(w.start + 0.05, w.end + d); else w.start = Math.max(0, Math.min(w.end - 0.05, w.start + d)); });
    const words = [];
    for (let k = 0; k < n; k++) {
      const w = src[l.i0 + k];
      words.push(h("button.wchip" + (w.em ? ".on" : ""), { onclick: () => { change(() => { w.em = !w.em; }); render(); } }, w.text));
      if (k < n - 1) words.push(h("button.wcut", { "aria-label": "Разделить здесь", title: "Разделить здесь", onclick: () => { change(() => { w.br = true; delete w.nb; }); render(); } }, "⏎"));
    }
    const box = [inp,
      h("p.hint", {}, "Нажмите на слово — оно станет ключевым (другой цвет). Значок ⏎ между словами делит строку на две."),
      h("div.wrow", {}, words),
      h("div.times", {}, h("span", {}, "Начало"), h("button.btn", { onclick: () => { nudge(0, -0.1); render(); } }, "раньше"), h("button.btn", { onclick: () => { nudge(0, 0.1); render(); } }, "позже"),
        h("span", {}, "Конец"), h("button.btn", { onclick: () => { nudge(1, -0.1); render(); } }, "раньше"), h("button.btn", { onclick: () => { nudge(1, 0.1); render(); } }, "позже")),
      h("div.row-btns", {},
        h("button.btn", { disabled: !canJoin, onclick: () => { change(() => { src[l.i1].nb = true; delete src[l.i1].br; }); render(); } }, "Склеить со следующей"),
        h("button.btn.danger", { onclick: () => { change(() => src.splice(l.i0, n)); s.close(); } }, "Удалить строку")),
      h("button.btn.primary.wide", { onclick: () => { applyText(); s.close(); } }, "Готово")];
    if (s) s.body.replaceChildren(...box); else s = sheet("Строка субтитров", box);
  };
  render();
}
