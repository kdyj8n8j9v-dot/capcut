// Редактор: превью, таймлайн (резка, обрезка краёв, перестановка), кадр, цвет, звук.
import { h, icon, sheet, toast, ask, askText, fmtTime, clamp } from "./ui.js";
import { db, uid, settings } from "./store.js";
import { createRenderer, GRADE_DEFAULT, FRAME_DEFAULT, HSL_BANDS } from "./gl.js";
import { mediaUrl, library, ensure, onMedia, busyOf, ensureWords } from "./media.js";
import { buildLines, drawSubs, drawClouds, drawMask, normStyle, PRESETS, CLOUD_DEFAULT, MASK_DEFAULT, MASK_SHAPES } from "./subs.mjs";
import { useFont } from "./fonts.js";
import { subsPanel, openLine, openSubsTab, colorPicker } from "./subsui.js";
import { cloud } from "./cloud.js";
import { openLibrary } from "./library.js";
import { openExport } from "./export.js";
import { pushProject, remoteNewer } from "./sync.js";

export const FORMATS = {
  "9:16": { w: 2160, h: 3840, label: "Вертикальное", hint: "Reels, Shorts, TikTok" },
  "16:9": { w: 3840, h: 2160, label: "Горизонтальное", hint: "YouTube, телевизор" },
  "1:1": { w: 2160, h: 2160, label: "Квадрат", hint: "Лента" },
  "4:5": { w: 2160, h: 2700, label: "Портрет 4:5", hint: "Лента Instagram" },
};
const MIN_LEN = 0.2;
const GROUPS = [
  ["Свет", [["exposure", "Экспозиция"], ["brightness", "Яркость"], ["contrast", "Контраст"], ["highlights", "Света"], ["shadows", "Тени"], ["whites", "Белые"], ["blacks", "Чёрные"]]],
  ["Цвет", [["temp", "Температура"], ["tint", "Оттенок"], ["saturation", "Насыщенность"], ["vibrance", "Сочность"]]],
  ["Детали", [["sharpness", "Резкость"], ["clarity", "Чёткость"], ["vignette", "Виньетка"]]],
  ["Кожа", [["skin_smooth", "Сглаживание", 0], ["skin_tone", "Выравнивание тона", 0], ["skin_sat", "Насыщенность"], ["skin_light", "Светлота"]]],
];
const BAND_COLORS = ["#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#40c8e0", "#0a84ff", "#bf5af2", "#ff375f"];

export async function openEditor(P, onExit) {
  P.clips ||= []; P.media ||= {}; P.grade ||= {}; P.format ||= "9:16"; P.volume ??= 1; P.words ||= {}; P.clouds ||= [];
  const root = document.getElementById("app");
  let t = 0, sel = null, pps = 40, playing = false, pi = 0, panel = null, alive = true, lastTick = 0;
  const undo = [], redo = [];
  const vids = new Map();     // key → { v, w, h, ok }
  const thumbs = new Map();   // key → [{ t, c }]
  const out = () => FORMATS[P.format] || FORMATS["9:16"];
  const len = (c) => c.out - c.in;
  const total = () => P.clips.reduce((a, c) => a + len(c), 0);
  const startOf = (i) => P.clips.slice(0, i).reduce((a, c) => a + len(c), 0);
  function locate(time) {
    let a = 0;
    for (let i = 0; i < P.clips.length; i++) {
      const d = len(P.clips[i]);
      if (time < a + d || i === P.clips.length - 1) return { i, clip: P.clips[i], local: clamp(time - a, 0, d) };
      a += d;
    }
    return null;
  }
  const target = () => locate(t)?.clip || null;   // кадр меняем у того клипа, который сейчас на экране
  let shown = null;

  // ——— история и сохранение
  const snap = () => JSON.stringify({ clips: P.clips, grade: P.grade, format: P.format, volume: P.volume, subs: P.subs || null, words: P.words, clouds: P.clouds });
  let saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { P.updated = Date.now(); P.duration = total(); db.put("projects", P).catch(() => {}); }, 300);
    dirty = true; clearTimeout(pushT); pushT = setTimeout(push, 4000);
  }
  // облако: проект уходит в MEGA через несколько секунд после правки; новые версии из чата «Монтаж» подтягиваются сами
  let dirty = false, pushT, pushing = false;
  async function push() {
    if (pushing || !alive || !dirty || !cloud.signedIn()) return;
    pushing = true; dirty = false;
    try { await pushProject(P); } catch { dirty = true; }
    pushing = false;
  }
  async function checkRemote() {
    if (!alive || pushing || document.hidden) return;
    try {
      const r = await remoteNewer(P);
      if (!r || !alive) return;
      if (dirty && !(await ask("В облаке новая версия проекта", (r.by === "claude" ? "Её прислал чат «Монтаж»." : "Она сохранена с другого вашего устройства.") + " Загрузить её? Ваши последние правки на этом устройстве заменятся.", "Загрузить", false))) return;
      for (const k of Object.keys(P)) delete P[k];
      Object.assign(P, r); P.clips ||= []; P.media ||= {}; P.grade ||= {}; P.words ||= {}; P.clouds ||= [];
      dirty = false; undo.length = redo.length = 0; sel = null; cloudSel = null; subSel = []; subAll = true; subWord = null;
      await db.put("projects", P); titleBtn.textContent = P.name;
      pause(); await loadAll(); fit(); renderPanel(); syncBar(); seek(Math.min(t, total()));
      toast(r.by === "claude" ? "Проект обновлён: чат «Монтаж» прислал новую версию" : "Проект обновлён с другого устройства", 4000);
    } catch {}
  }
  const remoteTimer = setInterval(checkRemote, 25000);
  function begin() { const s = snap(); if (undo[undo.length - 1] !== s) undo.push(s); if (undo.length > 100) undo.shift(); redo.length = 0; syncBar(); }
  function restore(from, to) {
    if (!from.length) return;
    to.push(snap());
    Object.assign(P, JSON.parse(from.pop()));
    if (!P.clips.some((c) => c.id === sel)) sel = null;
    pause(); layout(); seek(Math.min(t, total())); renderPanel(); syncBar(); save();
  }

  // ——— экран
  const canvas = h("canvas"), over = h("canvas.over");
  const R = createRenderer(canvas);
  const empty = h("div.empty", {},
    h("div.empty-title", {}, "Начните с видео"),
    h("div.muted", {}, "Возьмите его из MEGA или с этого устройства."),
    h("button.btn.primary.big", { onclick: addMedia }, icon("plus", 20), "Добавить видео"));
  const guides = h("div.guides", { hidden: true });
  const guideBtn = h("button.chip.guide-btn", { onclick: () => { settings.set("guides", !settings.get("guides")); fit(); } }, "Рамка");
  const view = h("div.view", {}, canvas, over, guides, empty, guideBtn);
  const side = h("aside.panel", { hidden: true });
  const tNow = h("span.t-now", {}, "0:00,0"), tAll = h("span.t-all", {}, "0:00");
  const playBtn = h("button.round.play", { onclick: toggle, "aria-label": "Пуск" }, icon("play", 22));
  const scroll = h("div.tl-scroll"), ruler = h("div.tl-ruler"), track = h("div.tl-track"), subRow = h("div.tl-subs"), cloudRow = h("div.tl-clouds"), inner = h("div.tl-inner", {}, ruler, track, subRow, cloudRow);
  scroll.append(inner);
  const titleBtn = h("button.title", { onclick: rename }, P.name);
  const fmtBtn = h("button.chip", { onclick: pickFormat, "aria-label": "Формат" }, P.format);
  const undoBtn = h("button.round", { onclick: () => restore(undo, redo), "aria-label": "Отменить" }, icon("undo", 20));
  const redoBtn = h("button.round", { onclick: () => restore(redo, undo), "aria-label": "Вернуть" }, icon("redo", 20));
  const tool = (id, ic, label, fn) => h("button.tool", { "data-tool": id, onclick: fn }, icon(ic), h("span", {}, label));
  const tools = h("nav.tools", {},
    tool("media", "plus", "Медиа", addMedia), tool("split", "split", "Разрезать", split),
    tool("frame", "crop", "Кадр", () => openPanel("frame")), tool("mask", "mask", "Маска", () => openPanel("mask")), tool("color", "color", "Цвет", () => openPanel("color")),
    tool("subs", "text", "Субтитры", () => openPanel("subs")), tool("cloud", "cloud", "Облако", () => openPanel("cloud")), tool("sound", "sound", "Звук", () => openPanel("sound")), tool("delete", "trash", "Удалить", remove));
  const ed = h("div.ed", {},
    h("header.bar", {},
      h("button.link", { onclick: exit }, icon("back", 20), "Проекты"), titleBtn,
      h("div.bar-right", {}, undoBtn, redoBtn, fmtBtn, h("button.btn.primary", { onclick: doExport }, icon("share", 18), "Экспорт"))),
    h("div.stage", {}, view, side),
    h("div.transport", {}, h("div.times", {}, tNow, h("span.muted", {}, " / "), tAll), playBtn,
      h("div.zoom", {}, h("button.round", { onclick: () => zoom(1 / 1.5), "aria-label": "Мельче" }, icon("zoomout", 18)),
        h("button.round", { onclick: () => zoom(1.5), "aria-label": "Крупнее" }, icon("zoomin", 18)))),
    h("div.tl", {}, h("div.tl-grab", { title: "Потяните, чтобы изменить высоту дорожек" }), scroll, h("div.tl-head")),
    tools);
  root.replaceChildren(ed);

  function syncBar() {
    undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
    const none = !P.clips.length;
    empty.hidden = !none; canvas.hidden = over.hidden = guideBtn.hidden = none;
    for (const b of tools.children) {
      const id = b.dataset.tool;
      b.disabled = id !== "media" && none || id === "delete" && !sel && !(panel === "cloud" && cloudSel);
      b.classList.toggle("on", id === panel);
    }
    tAll.textContent = fmtTime(total());
    tNow.textContent = fmtTime(t, true);
    playBtn.replaceChildren(icon(playing ? "pause" : "play", 22));
    fmtBtn.textContent = P.format;
  }

  // ——— размер превью
  function fit() {
    const o = out(), bw = view.clientWidth - 16, bh = view.clientHeight - 16;
    if (bw <= 0 || bh <= 0) return;
    const k = Math.min(bw / o.w, bh / o.h), cw = Math.round(o.w * k), ch = Math.round(o.h * k);
    canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
    const dpr = Math.min(2, devicePixelRatio || 1), q = Math.min(1, 1080 / (Math.min(cw, ch) * dpr));
    canvas.width = Math.max(2, Math.round(cw * dpr * q)); canvas.height = Math.max(2, Math.round(ch * dpr * q));
    over.style.width = cw + "px"; over.style.height = ch + "px"; over.width = canvas.width; over.height = canvas.height;
    // рамка Instagram: где интерфейс закрывает картинку (в готовое видео не попадает)
    const gOn = !!settings.get("guides") && P.clips.length > 0;
    guides.hidden = !gOn; guideBtn.classList.toggle("on", gOn);
    guides.style.width = cw + "px"; guides.style.height = ch + "px";
    guides.replaceChildren(...(P.format === "9:16"
      ? [h("i.gz", { style: { top: 0, height: "12%" } }, h("b", {}, "шапка")), h("i.gz", { style: { bottom: 0, height: "21%" } }, h("b", {}, "подпись и кнопки")),
        h("i.gz", { style: { right: 0, width: "15%", top: "45%", height: "34%" } }), h("i.gl", { style: { top: "14.85%" } }, h("b", {}, "лента 4:5")), h("i.gl", { style: { top: "85.15%" } }),
        h("i.gv", { style: { left: "5.5%" } }), h("i.gv", { style: { left: "94.5%" } })]
      : [h("i.gv", { style: { left: "5%" } }), h("i.gv", { style: { left: "95%" } }), h("i.gl", { style: { top: "5%" } }), h("i.gl", { style: { top: "95%" } }), h("i.gv.c", { style: { left: "50%" } }), h("i.gl.c", { style: { top: "50%" } })]));
    const pad = scroll.clientWidth / 2;
    inner.style.padding = `0 ${pad}px`;
    scroll.scrollLeft = t * pps;
    draw();
  }
  const grab = ed.querySelector(".tl-grab"), tl = ed.querySelector(".tl");
  const setTlh = (v) => { tl.style.height = clamp(v, 96, Math.round(innerHeight * 0.55)) + "px"; };

  let gdrag = null;
  grab.addEventListener("pointerdown", (e) => { gdrag = { y: e.clientY, h: tl.offsetHeight }; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener("pointermove", (e) => { if (gdrag) setTlh(gdrag.h + gdrag.y - e.clientY); });
  grab.addEventListener("pointerup", () => { if (gdrag) { settings.set("tlh", tl.offsetHeight); gdrag = null; } });
  const ro = new ResizeObserver(fit); ro.observe(view); ro.observe(scroll);

  // ——— видео
  async function video(key) {
    if (vids.has(key)) return vids.get(key);
    const url = await mediaUrl(key);
    if (!url) return null;
    if (vids.has(key)) return vids.get(key);
    const v = h("video.src", { playsInline: true, preload: "auto", crossOrigin: "anonymous" });
    v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    const rec = { v, w: 0, h: 0, ok: false };
    vids.set(key, rec);
    v.addEventListener("loadeddata", () => { rec.w = v.videoWidth; rec.h = v.videoHeight; rec.ok = true; seek(t); makeThumbs(key); });
    v.addEventListener("seeked", draw);
    v.src = url; ed.append(v);
    return rec;
  }
  async function loadAll() {
    await Promise.all(Object.keys(P.media).map(video));
    layout(); seek(t);
    restoreMissing();
  }
  // копии для превью, которых нет на этом устройстве, — подтянуть из MEGA
  let restoring = false;
  async function restoreMissing() {
    const miss = Object.keys(P.media).filter((k) => !vids.has(k));
    if (!miss.length || restoring || !cloud.signedIn()) return;
    restoring = true;
    try {
      const lib = await library();
      for (const k of miss) {
        const m = lib.find((x) => x.key === k);
        if (m && (m.proxy || m.local)) { try { await ensure(m); await video(k); layout(); } catch {} }
      }
    } catch {} finally { restoring = false; }
  }
  const offMedia = onMedia(() => { if (alive) { for (const k of Object.keys(P.media)) if (!vids.has(k)) video(k).then((r) => r && layout()); layoutBusy(); } });

  function draw() {
    if (!R || !alive) return;
    const loc = locate(t), rec = loc && vids.get(loc.clip.media);
    if (rec && rec.ok) R.draw(rec.v, rec.w, rec.h, out(), loc.clip.frame, P.grade);
    else R.draw(null);
    const c2 = over.getContext("2d");
    c2.clearRect(0, 0, over.width, over.height);
    drawMask(c2, over.width, over.height, loc && loc.clip.mask);
    drawClouds(c2, over.width, over.height, t, P.clouds);
    if (P.subs?.on && lines.length) drawSubs(c2, over.width, over.height, t, lines, subStyle());
  }
  function seek(time, fromScroll) {
    t = clamp(time, 0, total());
    const loc = locate(t);
    for (const [k, r] of vids) if (!loc || k !== loc.clip.media) r.v.pause();
    if (loc) {
      const rec = vids.get(loc.clip.media);
      if (rec && rec.ok) {
        const want = Math.min(loc.clip.in + loc.local, loc.clip.out - 0.001);
        if (Math.abs(rec.v.currentTime - want) > 0.005) rec.v.currentTime = want;
      }
    }
    if (!fromScroll) scroll.scrollLeft = t * pps;
    tNow.textContent = fmtTime(t, true);
    draw();
    if ((panel === "frame" || panel === "mask") && loc?.clip.id !== shown && !ptrs.size) renderPanel();
  }
  function setVolume() { for (const r of vids.values()) { r.v.volume = clamp(P.volume, 0, 1); r.v.muted = P.volume <= 0; } }
  function play() {
    if (!P.clips.length) return;
    if (t >= total() - 0.05) seek(0);
    const loc = locate(t);
    pi = loc.i; playing = true; lastTick = performance.now();
    setVolume();
    // iPad/iPhone: каждое видео должно быть запущено касанием хотя бы раз
    for (const [k, r] of vids) if (k !== loc.clip.media && !r.unlocked) { r.unlocked = true; const p = r.v.play(); p && p.then(() => { if (!playing || P.clips[pi]?.media !== k) r.v.pause(); }).catch(() => {}); }
    const rec = vids.get(loc.clip.media);
    if (rec) { rec.unlocked = true; rec.v.play().catch(() => {}); }
    syncBar(); requestAnimationFrame(tick);
  }
  function pause() { stopAt = null; if (!playing) return; playing = false; for (const r of vids.values()) r.v.pause(); syncBar(); }
  function toggle() { playing ? pause() : play(); }
  function tick(now) {
    if (!playing || !alive) return;
    const c = P.clips[pi], rec = c && vids.get(c.media), dt = (now - lastTick) / 1000; lastTick = now;
    if (!c) return pause();
    let local;
    if (rec && rec.ok) local = rec.v.currentTime - c.in; else local = t - startOf(pi) + dt;   // нет копии — чёрный кадр, время идёт
    if (local >= len(c) - 0.015 || (rec && rec.v.ended)) {
      if (rec) rec.v.pause();
      pi++;
      if (pi >= P.clips.length) { playing = false; t = total(); scroll.scrollLeft = t * pps; syncBar(); draw(); return; }
      const n = P.clips[pi], nr = vids.get(n.media);
      t = startOf(pi);
      if (nr && nr.ok) { nr.v.currentTime = n.in; nr.v.play().catch(() => {}); }
    } else t = startOf(pi) + Math.max(0, local);
    scroll.scrollLeft = t * pps;
    tNow.textContent = fmtTime(t, true);
    draw();
    if (stopAt != null && t >= stopAt) return pause();
    requestAnimationFrame(tick);
  }

  // ——— субтитры
  let lines = [];
  const subStyle = () => normStyle(P.subs?.style);
  function loadFont(name) { useFont(name).then(draw).catch(() => {}); }
  // что меняем: все субтитры, выбранные строки или одно слово
  let subAll = true, subSel = [], subWord = null, lastPick = null;
  const lineId = (l) => l.key + ":" + l.i0;
  const isSel = (l) => subSel.includes(lineId(l));
  const selLines = () => lines.filter(isSel);
  function relines() {
    lines = P.subs ? buildLines(P.clips, P.words, P.subs.style) : [];
    subSel = subSel.filter((id) => lines.some((l) => lineId(l) === id));
    if (subWord && !(selLines().length === 1 && subWord.idx >= selLines()[0].i0 && subWord.idx <= selLines()[0].i1 && subWord.key === selLines()[0].key)) subWord = null;
    if (P.subs) for (const f of new Set([subStyle().font, ...lines.flatMap((l) => [l.style?.font, ...l.words.map((w) => w.style?.font)])])) if (f) loadFont(f);
    subRow.style.width = total() * pps + "px";
    subRow.hidden = !lines.length;
    subRow.classList.toggle("off", !P.subs?.on);
    const one = !subAll && subSel.length === 1 ? subSel[0] : null, nLayers = Math.max(1, ...lines.map((l) => (l.layer | 0) + 1));
    const chip = (l, i) => h("button.sub" + (isSel(l) ? ".sel" : "") + (lineId(l) === one ? ".one" : "") + (l.style || l.words.some((w) => w.style) ? ".own" : ""), { "data-i": i,
      style: { left: l.start * pps + "px", width: Math.max(4, (l.end - l.start) * pps - 2) + "px" } }, l.words.map((w) => w.text).join(" "), ...animBars(l),
      h("i.g.l", { "data-side": "l" }), h("i.g.r", { "data-side": "r" }));
    requestAnimationFrame(autoTl);
    subRow.replaceChildren(...Array.from({ length: nLayers }, (_, n) => h("div.srow", {}, lines.map((l, i) => ((l.layer | 0) === n ? chip(l, i) : null)))));
    if (!sdrag) reveal(subRow.querySelector(".sub.one"));
  }
  // полоски на плашке: сколько длится появление и исчезание
  // высота таймлайна сама подстраивается под число дорожек (пока владелец не задал свою за «ручку»)
  function autoTl() {
    const tlEl = ed.querySelector(".tl"), narrow = innerWidth < 820;
    // на телефоне с открытой панелью превью важнее: таймлайн низкий и прокручивается
    const cap = narrow && panel ? 104 : Math.round(innerHeight * (narrow ? 0.3 : 0.45));
    const rows = ruler.offsetHeight + track.offsetHeight + (subRow.hidden ? 0 : subRow.offsetHeight + 3) + (cloudRow.hidden ? 0 : cloudRow.offsetHeight + 3);
    const want = Math.min(cap, settings.get("tlh") || Math.max(112, rows + 30));
    if (Math.abs(tlEl.offsetHeight - want) > 2) tlEl.style.height = want + "px";
  }
  // выбранный субтитр или облако должны быть видны: прокрутить дорожки по вертикали
  function reveal(el) {
    if (!el) return;
    requestAnimationFrame(() => { if (!el.isConnected) return; const r = el.getBoundingClientRect(), b = scroll.getBoundingClientRect(); if (r.bottom > b.bottom - 2) scroll.scrollTop += r.bottom - b.bottom + 6; else if (r.top < b.top + 2) scroll.scrollTop -= b.top - r.top + 6; });
  }
  function animBars(l) {
    const st = normStyle({ ...(P.subs.style || {}), ...(l.style || {}) }), len = l.end - l.start, out = [];
    if (st.in !== "none") out.push(h("i.ain", { style: { width: Math.min(len, st.inDur) * pps + "px" } }));
    if (st.out !== "none") out.push(h("i.aout", { style: { width: Math.min(len, st.outDur) * pps + "px" } }));
    return out;
  }
  // ——— облака: отдельные объекты на своей дорожке
  let cloudSel = null, cdrag = null;
  function layoutClouds() {
    cloudRow.style.width = total() * pps + "px"; cloudRow.hidden = !P.clouds.length;
    cloudRow.replaceChildren(...P.clouds.map((c) => h("div.cl" + (c.id === cloudSel ? ".sel" : ""), { "data-id": c.id, style: { left: c.start * pps + "px", width: Math.max(8, (c.end - c.start) * pps - 2) + "px" } },
      h("span", {}, "Облако"), h("i.g.l", { "data-side": "l" }), h("i.g.r", { "data-side": "r" }))));
    autoTl(); reveal(cloudRow.querySelector(".cl.sel"));
  }
  function addCloud() {
    begin(); pause();
    const start = Math.min(t, Math.max(0, total() - 0.5)), c = { id: uid(), start, end: Math.min(total(), start + 3), ...CLOUD_DEFAULT, y: subStyle().y };
    P.clouds.push(c); cloudSel = c.id; layoutClouds(); draw(); renderPanel(); syncBar(); save();
  }
  function removeCloud() { begin(); P.clouds = P.clouds.filter((c) => c.id !== cloudSel); cloudSel = null; layoutClouds(); draw(); renderPanel(); syncBar(); save(); }
  cloudRow.addEventListener("click", (e) => {
    const el = e.target.closest(".cl"); if (!el || cloudRow.dataset.drag) return;
    e.stopPropagation(); cloudSel = el.dataset.id; pause();
    const c = P.clouds.find((x) => x.id === cloudSel); if (t < c.start || t >= c.end) seek(c.start + Math.min(0.3, (c.end - c.start) / 2));
    if (panel !== "cloud") { panel = "cloud"; requestAnimationFrame(fit); }
    layoutClouds(); renderPanel(); syncBar();
  });
  cloudRow.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".cl.sel"); if (!el || e.button > 0) return;
    const c = P.clouds.find((x) => x.id === el.dataset.id);
    e.preventDefault(); pause();
    cdrag = { c, el, side: e.target.dataset.side || "m", x: e.clientX, s0: c.start, e0: c.end, id: e.pointerId, moved: false };
    cloudRow.setPointerCapture(e.pointerId);
  });
  cloudRow.addEventListener("pointermove", (e) => {
    if (!cdrag || e.pointerId !== cdrag.id) return;
    const d = (e.clientX - cdrag.x) / pps, c = cdrag.c, tot = total(), len = cdrag.e0 - cdrag.s0;
    if (!cdrag.moved) { if (Math.abs(e.clientX - cdrag.x) < 4) return; cdrag.moved = true; begin(); }
    if (cdrag.side === "l") c.start = clamp(cdrag.s0 + d, 0, c.end - 0.2);
    else if (cdrag.side === "r") c.end = clamp(cdrag.e0 + d, c.start + 0.2, tot);
    else { c.start = clamp(cdrag.s0 + d, 0, Math.max(0, tot - len)); c.end = c.start + len; }
    cdrag.el.style.left = c.start * pps + "px"; cdrag.el.style.width = Math.max(8, (c.end - c.start) * pps - 2) + "px";
    draw();
  });
  const cdragEnd = (e) => { if (!cdrag || e.pointerId !== cdrag.id) return; const m = cdrag.moved; cdrag = null; if (m) { cloudRow.dataset.drag = "1"; setTimeout(() => delete cloudRow.dataset.drag, 60); layoutClouds(); draw(); save(); } };
  cloudRow.addEventListener("pointerup", cdragEnd); cloudRow.addEventListener("pointercancel", cdragEnd);
  function pickLine(i, e) {
    const l = lines[i]; if (!l) return;
    if (e && e.shiftKey && lastPick != null) { const [a, b] = [Math.min(lastPick, i), Math.max(lastPick, i)]; subSel = [...new Set([...subSel, ...lines.slice(a, b + 1).map(lineId)])]; }
    else subSel = isSel(l) ? subSel.filter((id) => id !== lineId(l)) : [...subSel, lineId(l)];
    lastPick = i; subWord = null; subAll = !subSel.length && subAll;
    if (subSel.length) subAll = false;
    pause(); if (isSel(l)) seek(l.start + Math.min(0.3, (l.end - l.start) / 2));
    if (panel !== "subs") { panel = "subs"; requestAnimationFrame(fit); }
    relines(); renderPanel(); syncBar();
  }
  subRow.addEventListener("click", (e) => { if (subRow.dataset.lasso) return; const b = e.target.closest(".sub"); if (b) { e.stopPropagation(); pickLine(+b.dataset.i, e); } });
  subRow.addEventListener("dblclick", (e) => { const b = e.target.closest(".sub"); if (b) { e.stopPropagation(); const l = lines[+b.dataset.i]; subSel = [lineId(l)]; subAll = false; relines(); renderPanel(); openLine(subApi, +b.dataset.i); } });
  // мышь: протянуть по дорожке субтитров — выбрать несколько подряд
  let lasso = null;
  let sdrag = null;
  subRow.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".sub.one"); if (!el || e.button > 0) return;
    const l = lines[+el.dataset.i], o = P.words[l.key][l.i0].ls || {};
    e.stopPropagation(); pause();
    sdrag = { key: l.key, i0: l.i0, i1: l.i1, side: e.target.dataset.side || "m", x: e.clientX, mv: o.mv || 0, ds: o.ds || 0, de: o.de || 0, id: e.pointerId, moved: false };
    subRow.setPointerCapture(e.pointerId);
  }, true);
  subRow.addEventListener("pointermove", (e) => {
    if (!sdrag || e.pointerId !== sdrag.id) return;
    if (!sdrag.moved) { if (Math.abs(e.clientX - sdrag.x) < 4) return; sdrag.moved = true; begin(); P.words[sdrag.key][sdrag.i1].br = true; }
    const d = (e.clientX - sdrag.x) / pps, o = (P.words[sdrag.key][sdrag.i0].ls ||= {});
    if (sdrag.side === "l") o.ds = sdrag.ds + d; else if (sdrag.side === "r") o.de = sdrag.de + d; else o.mv = sdrag.mv + d;
    relines(); draw();
  });
  const sdragEnd = (e) => { if (!sdrag || e.pointerId !== sdrag.id) return; const m = sdrag.moved; sdrag = null; if (m) { subRow.dataset.lasso = "1"; setTimeout(() => delete subRow.dataset.lasso, 60); renderPanel(); save(); } };
  subRow.addEventListener("pointerup", sdragEnd); subRow.addEventListener("pointercancel", sdragEnd);
  subRow.addEventListener("pointerdown", (e) => { if (sdrag || e.pointerType !== "mouse" || e.button) return; lasso = { x: e.clientX, id: e.pointerId, on: false, box: null }; });
  subRow.addEventListener("pointermove", (e) => {
    if (!lasso || e.pointerId !== lasso.id) return;
    if (!lasso.on) { if (Math.abs(e.clientX - lasso.x) < 6) return; lasso.on = true; subRow.setPointerCapture(e.pointerId); lasso.box = h("div.lasso"); subRow.append(lasso.box); }
    const r = subRow.getBoundingClientRect(), a = Math.min(lasso.x, e.clientX) - r.left, b = Math.max(lasso.x, e.clientX) - r.left;
    lasso.box.style.left = a + "px"; lasso.box.style.width = b - a + "px";
    for (const c of subRow.querySelectorAll(".sub")) { const l = lines[+c.dataset.i], hit = l.end * pps > a && l.start * pps < b; c.classList.toggle("sel", hit); }
  });
  const lassoEnd = (e) => {
    if (!lasso || e.pointerId !== lasso.id) return;
    const was = lasso; lasso = null;
    if (!was.on) return;
    subSel = [...subRow.querySelectorAll(".sub.sel")].map((c) => lineId(lines[+c.dataset.i]));
    subAll = !subSel.length; subWord = null;
    subRow.dataset.lasso = "1"; setTimeout(() => delete subRow.dataset.lasso, 60);
    if (panel !== "subs") { panel = "subs"; requestAnimationFrame(fit); }
    relines(); renderPanel(); syncBar();
  };
  subRow.addEventListener("pointerup", lassoEnd); subRow.addEventListener("pointercancel", lassoEnd);
  // показать анимацию: проиграть строку под линией
  let stopAt = null;
  function playLine() {
    const l = (!subAll && selLines()[0]) || lines.find((x) => t >= x.start - 0.05 && t < x.end) || lines.find((x) => x.start >= t) || lines[0];
    if (!l) return;
    pause(); seek(Math.max(0, l.start - 0.05)); stopAt = l.end + 0.05; play();
  }
  const POS = ["x", "y", "rot", "shift"];
  // куда записываются изменения: общий стиль, свои настройки выбранных строк (у первого слова строки) или одного слова
  const targets = () => {
    if (subAll || !P.subs) return [P.subs.style ||= {}];
    if (subWord) return [(P.words[subWord.key][subWord.idx].ws ||= {})];
    return selLines().map((l) => (P.words[l.key][l.i0].ls ||= {}));
  };
  const subApi = {
    P, lines: () => lines, begin, seek, playLine,
    get all() { return subAll; }, get word() { return subWord; }, selLines,
    scope: () => (subAll ? "all" : subWord ? "word" : "lines"),
    setAll(v) { subAll = v; subWord = null; if (!v && !subSel.length) { const l = lines.find((x) => t >= x.start && t < x.end) || lines.find((x) => x.start >= t) || lines[0]; if (l) subSel = [lineId(l)]; } if (v) subSel = []; relines(); renderPanel(); },
    setWord(idx) { const l = selLines()[0]; subWord = idx == null || !l ? null : { key: l.key, idx }; renderPanel(); },
    clearSel() { subSel = []; subWord = null; relines(); renderPanel(); },
    // настройки, которые сейчас видит панель
    cur: () => { const l = !subAll && selLines()[0]; const w = l && subWord && P.words[subWord.key][subWord.idx]; return normStyle({ ...(P.subs?.style || {}), ...((l && l.style) || {}), ...((w && w.ws) || {}) }); },
    st: () => new Proxy({}, { set: (_, k, v) => { for (const o of targets()) o[k] = v; return true; }, get: (_, k) => subApi.cur()[k] }),
    gst: () => (P.subs.style ||= {}),
    applyStyle(v) {
      if (subAll) { const c = subStyle(), keep = {}; for (const k of POS) keep[k] = c[k]; P.subs.style = { ...v, ...keep }; }
      else for (const l of selLines()) { const w = P.words[l.key][l.i0], keep = {}; for (const k of POS) if (w.ls && k in w.ls) keep[k] = w.ls[k]; w.ls = { ...v, ...keep }; }
    },
    // отправить выбранные субтитры на другой слой; строка при этом «замораживается» (её слова больше не перегруппируются)
    setLayer(n) { for (const l of selLines()) { const src = P.words[l.key], o = (src[l.i0].ls ||= {}); if (n) o.layer = n; else delete o.layer; src[l.i1].br = true; delete src[l.i1].nb; } },
    resetOwn() { for (const l of selLines()) { if (subWord) delete P.words[subWord.key][subWord.idx].ws; else { for (let k = l.i0; k <= l.i1; k++) { delete P.words[l.key][k].ls; delete P.words[l.key][k].ws; } } } },
    change: (fn) => { begin(); fn(); relines(); draw(); renderPanel(); save(); },
    live: () => { relines(); draw(); save(); },
    rerender: () => { if (panel === "subs") renderPanel(); },
    busy: () => {}, get making() { return making; }, makeSubs: () => makeSubs(),
  };
  let making = false;
  async function makeSubs() {
    if (making) return;
    making = true; renderPanel();
    try {
      const got = {};
      for (const k of new Set(P.clips.map((c) => c.media))) got[k] = await ensureWords(k, P.media[k].name);
      if (!Object.values(got).some((w) => w.length)) throw new Error("В этих видео не нашлось речи.");
      begin();
      Object.assign(P.words, JSON.parse(JSON.stringify(got)));
      P.subs = { on: true, style: { ...(P.subs?.style || PRESETS[1][1]) } };
      openSubsTab(0); relines(); draw(); save(); toast("Субтитры готовы. Выберите стиль");
    } catch (e) { toast(e.message, 6000); }
    making = false; renderPanel();
  }

  // ——— миниатюры на дорожке
  async function makeThumbs(key) {
    if (thumbs.has(key)) return;
    const list = []; thumbs.set(key, list);
    const url = await mediaUrl(key), m = P.media[key];
    if (!url || !m) return;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    await new Promise((r) => { v.onloadeddata = r; v.onerror = r; });
    if (!v.videoWidth) return;
    const n = clamp(Math.ceil(m.dur / 2), 1, 40), th = 96, tw = Math.round(th * v.videoWidth / v.videoHeight);
    for (let i = 0; i < n && alive; i++) {
      const time = Math.min(m.dur - 0.05, (i + 0.5) * m.dur / n);
      await new Promise((r) => { v.onseeked = r; v.currentTime = time; setTimeout(r, 1500); });
      const c = document.createElement("canvas"); c.width = tw; c.height = th;
      c.getContext("2d").drawImage(v, 0, 0, tw, th);
      list.push({ t: time, c });
      if (i === 0 || i % 4 === 3 || i === n - 1) paintClips(key);
    }
    v.src = "";
    if (!P.thumb && P.clips[0]?.media === key && list[0]) { try { P.thumb = list[Math.min(1, list.length - 1)].c.toDataURL("image/jpeg", 0.7); save(); } catch {} }
  }
  function paint(el, clip) {
    const cv = el.querySelector("canvas"), list = thumbs.get(clip.media) || [];
    const w = Math.min(8000, Math.max(1, Math.round(len(clip) * pps))), hh = 56;
    cv.width = w; cv.height = hh;
    if (!list.length) return;
    const g = cv.getContext("2d"), tw = Math.round(hh * list[0].c.width / list[0].c.height), k = w / (len(clip) * pps);
    for (let x = 0; x < w; x += tw) {
      const time = clip.in + (x + tw / 2) / k / pps;
      let best = list[0];
      for (const th of list) if (Math.abs(th.t - time) < Math.abs(best.t - time)) best = th;
      g.drawImage(best.c, x, 0, tw, hh);
    }
  }
  function paintClips(key) { for (const el of track.querySelectorAll(".clip")) { const c = P.clips.find((x) => x.id === el.dataset.id); if (c && (!key || c.media === key)) paint(el, c); } }

  // ——— таймлайн
  function layout() {
    const tot = total();
    track.replaceChildren(...P.clips.map((c) => {
      const el = h("div.clip" + (c.id === sel ? ".sel" : "") + (vids.has(c.media) ? "" : ".missing"), { "data-id": c.id, style: { width: len(c) * pps + "px" } },
        h("canvas"), h("span.clip-len", {}, fmtTime(len(c), true)),
        vids.has(c.media) ? null : h("span.clip-note", {}, "нет копии на устройстве"),
        h("div.grip.l", { "data-side": "l" }), h("div.grip.r", { "data-side": "r" }));
      paint(el, c);
      return el;
    }), h("button.tl-add", { onclick: addMedia, "aria-label": "Добавить видео" }, icon("plus", 22)));
    // линейка
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 64) || 600;
    const marks = [];
    for (let s = 0; s <= tot + 1e-6; s += step) marks.push(h("span", { style: { left: s * pps + "px" } }, step < 1 ? fmtTime(s, true) : fmtTime(s)));
    ruler.replaceChildren(...marks); ruler.style.width = tot * pps + "px";
    relines(); layoutClouds(); layoutBusy(); syncBar();
  }
  function layoutBusy() {
    for (const el of track.querySelectorAll(".clip")) {
      const c = P.clips.find((x) => x.id === el.dataset.id), b = c && busyOf(c.media);
      let tag = el.querySelector(".clip-busy");
      if (!b) { tag && tag.remove(); continue; }
      if (!tag) el.append(tag = h("span.clip-busy"));
      tag.textContent = b.text + (b.p != null ? " " + Math.round(b.p * 100) + " %" : "…");
    }
  }
  function zoom(k) { pps = clamp(pps * k, 3, 240); layout(); scroll.scrollLeft = t * pps; }
  scroll.addEventListener("scroll", () => {
    if (drag) return;
    const ts = scroll.scrollLeft / pps;
    if (Math.abs(ts - t) * pps < 1.5) return;
    if (playing) pause();
    seek(ts, true);
  });
  // щипок двумя пальцами — масштаб дорожки
  let pinch = null;
  scroll.addEventListener("touchstart", (e) => { if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), pps }; }, { passive: true });
  scroll.addEventListener("touchmove", (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      pps = clamp(pinch.pps * d / pinch.d, 3, 240); layout(); scroll.scrollLeft = t * pps;
    } else if (drag) e.preventDefault();
  }, { passive: false });
  scroll.addEventListener("touchend", () => { pinch = null; }, { passive: true });
  scroll.addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });

  // касания клипов: выбор, края (обрезка), долгое нажатие (перестановка)
  let drag = null, press = null;
  track.addEventListener("click", (e) => {
    if (drag || track.dataset.justDragged) return;
    const el = e.target.closest(".clip");
    if (!el) return;
    sel = sel === el.dataset.id ? null : el.dataset.id;
    for (const c of track.querySelectorAll(".clip")) c.classList.toggle("sel", c.dataset.id === sel);
    syncBar();
  });
  scroll.addEventListener("click", (e) => { if (e.target === scroll || e.target === inner || e.target === track || e.target === ruler || e.target === subRow || e.target === cloudRow) { sel = null; layout(); } });
  track.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".clip");
    if (!el || e.button > 0) return;
    const clip = P.clips.find((c) => c.id === el.dataset.id), side = e.target.dataset.side;
    if (side && clip.id === sel) {
      e.preventDefault(); pause(); begin();
      drag = { kind: "trim", side, clip, el, x: e.clientX, in0: clip.in, out0: clip.out, id: e.pointerId, t0: startOf(P.clips.indexOf(clip)) };
      track.setPointerCapture(e.pointerId);
      return;
    }
    press = { el, clip, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(() => {
      if (!press) return;
      pause(); begin();
      const rects = [...track.querySelectorAll(".clip")].map((c) => c.getBoundingClientRect());
      drag = { kind: "move", clip, el, x: press.x, id: press.id, rects, from: P.clips.indexOf(clip), to: P.clips.indexOf(clip) };
      el.classList.add("lift"); track.classList.add("moving");
      try { track.setPointerCapture(press.id); } catch {}
      navigator.vibrate && navigator.vibrate(10);
      press = null;
    }, 380) };
  });
  track.addEventListener("pointermove", (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (drag.kind === "trim") {
      const c = drag.clip, m = P.media[c.media] || { dur: c.out };
      if (drag.side === "l") c.in = clamp(drag.in0 + dx / pps, 0, c.out - MIN_LEN);
      else c.out = clamp(drag.out0 + dx / pps, c.in + MIN_LEN, m.dur);
      drag.el.style.width = len(c) * pps + "px";
      drag.el.querySelector(".clip-len").textContent = fmtTime(len(c), true);
      // показать кадр на краю, который двигаем
      t = drag.side === "l" ? drag.t0 : drag.t0 + len(c) - 0.03;
      const rec = vids.get(c.media);
      if (rec && rec.ok) rec.v.currentTime = drag.side === "l" ? c.in : c.out - 0.03;
      tAll.textContent = fmtTime(total()); draw();
    } else {
      drag.el.style.transform = `translateX(${dx}px) scale(1.04)`;
      const r = drag.rects, mid = r[drag.from].left + r[drag.from].width / 2 + dx;
      let to = 0;
      r.forEach((q, i) => { if (i !== drag.from && mid > q.left + q.width / 2) to = i < drag.from ? i + 1 : i; });
      if (!r.some((q, i) => i !== drag.from && mid > q.left + q.width / 2)) to = 0;
      drag.to = to;
      [...track.querySelectorAll(".clip")].forEach((c, i) => {
        if (i === drag.from) return;
        const w = r[drag.from].width + 2;
        c.style.transform = i > drag.from && i <= to ? `translateX(${-w}px)` : i < drag.from && i >= to ? `translateX(${w}px)` : "";
      });
    }
  });
  const endDrag = (e) => {
    if (press) { clearTimeout(press.timer); press = null; }
    if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    track.classList.remove("moving");
    if (d.kind === "move") {
      if (d.to !== d.from) { P.clips.splice(d.to, 0, P.clips.splice(d.from, 1)[0]); sel = d.clip.id; } else undo.pop();
      track.dataset.justDragged = "1"; setTimeout(() => delete track.dataset.justDragged, 50);
    }
    layout(); seek(d.kind === "trim" ? (d.side === "l" ? d.t0 : d.t0 + len(d.clip) - 0.03) : startOf(P.clips.indexOf(d.clip)));
    save();
  };
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("contextmenu", (e) => e.preventDefault());

  // ——— действия
  function split() {
    const loc = locate(t);
    if (!loc || loc.local < MIN_LEN || len(loc.clip) - loc.local < MIN_LEN) return toast("Поставьте линию туда, где нужно разрезать");
    begin(); pause();
    const c = loc.clip, cut = c.in + loc.local;
    const b = { ...c, id: uid(), in: cut, frame: c.frame && { ...c.frame }, ...(c.mask ? { mask: { ...c.mask } } : {}) };
    c.out = cut;
    P.clips.splice(loc.i + 1, 0, b);
    sel = b.id; layout(); seek(t); save();
  }
  function remove() {
    if (panel === "cloud" && cloudSel) return removeCloud();
    const i = P.clips.findIndex((c) => c.id === sel);
    if (i < 0) return;
    begin(); pause();
    const at = startOf(i);
    P.clips.splice(i, 1); sel = null;
    layout(); seek(Math.min(at, total())); save();
    toast("Удалено. Вернуть — стрелка «Отменить» вверху");
  }
  function addClips(recs) {
    if (!recs.length) return;
    begin(); pause();
    let i = sel ? P.clips.findIndex((c) => c.id === sel) + 1 : P.clips.length, at = null;
    for (const m of recs) {
      P.media[m.key] = { name: m.name, dur: m.dur, w: m.w, h: m.h };
      const c = { id: uid(), media: m.key, in: 0, out: m.dur };
      P.clips.splice(i++, 0, c);
      at ??= c;
    }
    Promise.all(recs.map((m) => video(m.key))).then(() => { layout(); seek(startOf(P.clips.indexOf(at))); });
    if (P.clips.length === recs.length) pps = clamp((scroll.clientWidth * 0.8) / Math.max(1, total()), 3, 240);
    layout(); save();
  }
  function addMedia() { pause(); openLibrary({ onPick: addClips }); }
  async function rename() {
    const n = await askText("Название проекта", P.name);
    if (n) { P.name = n; titleBtn.textContent = n; save(); }
  }
  function pickFormat() {
    const s = sheet("Формат видео", h("div.list", {}, Object.entries(FORMATS).map(([k, f]) =>
      h("button.item", { onclick: () => { begin(); P.format = k; s.close(); fit(); syncBar(); save(); } },
        h("span.fmt-ic", {}, h("i", { style: { aspectRatio: `${f.w}/${f.h}` } })),
        h("span.item-main", {}, h("b", {}, f.label + " · " + k), h("small", {}, `${f.hint} · ${f.w}×${f.h}`)),
        k === P.format ? icon("check", 20) : null))));
  }
  function doExport() {
    pause();
    if (!P.clips.length) return toast("Сначала добавьте видео");
    clearTimeout(saveT); P.updated = Date.now(); P.duration = total();
    db.put("projects", P).then(() => openExport(P, out()));
  }

  // ——— панели: кадр, цвет, звук
  function openPanel(id) { panel = panel === id ? null : id; renderPanel(); syncBar(); requestAnimationFrame(fit); }
  function slider(label, get, set, { min = -1, max = 1, step = 0.01, def = 0, show } = {}) {
    show ||= (v) => Math.round(v * 100);
    const val = h("span.sl-val", {}, show(get()));
    const inp = h("input", { type: "range", min, max, step, value: get(), "aria-label": label,
      onpointerdown: begin, onkeydown: begin,
      oninput: () => { set(+inp.value); val.textContent = show(+inp.value); draw(); save(); } });
    const reset = () => { begin(); inp.value = def; set(def); val.textContent = show(def); draw(); save(); };
    return h("label.sl", {}, h("span.sl-top", {}, h("span", {}, label), h("button.sl-reset", { onclick: (e) => { e.preventDefault(); reset(); }, title: "Сбросить" }, val)), inp);
  }
  let colorTab = 0, band = 0;
  function renderPanel() {
    side.hidden = !panel;
    ed.classList.toggle("with-panel", !!panel);
    ed.classList.toggle("tall", panel === "subs" && !!P.subs);
    requestAnimationFrame(autoTl);
    if (!panel) return side.replaceChildren();
    const head = (title, onReset) => h("div.panel-head", {}, h("b", {}, title),
      h("div", {}, onReset && h("button.link", { onclick: onReset }, "Сбросить"), h("button.link.strong", { onclick: () => openPanel(panel) }, "Готово")));
    if (panel === "frame") {
      const c = target(); shown = c?.id;
      if (!c) return side.replaceChildren(head("Кадр"), h("p.muted", {}, "Добавьте видео."));
      const fr = () => (c.frame ||= { ...FRAME_DEFAULT });
      const m = P.media[c.media] || { w: 16, h: 9 }, o = out();
      const fitScale = Math.min(o.w / m.w, o.h / m.h) / Math.max(o.w / m.w, o.h / m.h);
      const setScale = (s) => { begin(); Object.assign(fr(), { scale: s, x: 0, y: 0 }); renderPanel(); draw(); save(); };
      side.replaceChildren(head("Кадр", () => { begin(); c.frame = { ...FRAME_DEFAULT }; renderPanel(); draw(); save(); }),
        h("p.hint", {}, "Двигайте видео пальцем прямо на экране, двумя пальцами — меняйте размер."),
        h("div.seg", {}, h("button", { onclick: () => setScale(1) }, "Заполнить кадр"), h("button", { onclick: () => setScale(fitScale) }, "Показать целиком")),
        slider("Размер", () => fr().scale, (v) => fr().scale = v, { min: 0.2, max: 4, def: 1 }),
        slider("Влево — вправо", () => fr().x, (v) => fr().x = v),
        slider("Вверх — вниз", () => fr().y, (v) => fr().y = v),
        slider("Поворот", () => fr().rot, (v) => fr().rot = v, { min: -180, max: 180, step: 0.5, show: (v) => Math.round(v) + "°" }));
    } else if (panel === "color") {
      const g = P.grade, tabs = [...GROUPS.map((x) => x[0]), "Оттенки"];
      let body;
      if (colorTab < GROUPS.length) body = GROUPS[colorTab][1].map(([k, label, min]) => slider(label, () => g[k] ?? GRADE_DEFAULT[k], (v) => g[k] = v, { min: min ?? -1 }));
      else {
        const b = HSL_BANDS[band], arr = () => ((g.hsl ||= {})[b] ||= [0, 0, 0]);
        body = [h("div.bands", {}, BAND_COLORS.map((col, i) => h("button" + (i === band ? ".on" : ""), { style: { background: col }, "aria-label": "Цвет " + (i + 1), onclick: () => { band = i; renderPanel(); } }))),
          ...["Тон", "Насыщенность", "Светлота"].map((label, i) => slider(label, () => (g.hsl?.[b] || [0, 0, 0])[i], (v) => arr()[i] = v))];
      }
      side.replaceChildren(head("Цвет", () => { begin(); P.grade = {}; renderPanel(); draw(); save(); }),
        h("div.seg.scroll", {}, tabs.map((n, i) => h("button" + (i === colorTab ? ".on" : ""), { onclick: () => { colorTab = i; renderPanel(); } }, n))),
        h("div.sliders", {}, body), h("p.hint", {}, "Цвет применяется ко всему ролику. Нажмите на число, чтобы вернуть ноль."));
    } else if (panel === "subs") {
      if (!P.subs) {
        return side.replaceChildren(head("Субтитры"),
          h("p.muted", {}, "Приложение само расставит слова по времени речи. Потом текст можно поправить, а вид — выбрать из готовых стилей."),
          h("button.btn.primary.wide.big", { onclick: makeSubs, disabled: making }, making ? "Готовлю… это может занять до 4 минут" : "Создать субтитры"));
      }
      subApi.slider = slider; subApi.head = head;
      side.replaceChildren(...subsPanel(subApi).flat(9).filter(Boolean));
    } else if (panel === "mask") {
      const c = target(); shown = c?.id;
      if (!c) return side.replaceChildren(head("Маска"), h("p.muted", {}, "Добавьте видео."));
      const m = c.mask && c.mask.shape !== "none" ? c.mask : null;
      const setShape = (k) => { begin(); if (k === "none") delete c.mask; else c.mask = { ...MASK_DEFAULT, ...(c.mask || {}), shape: k }; renderPanel(); draw(); save(); };
      const msl = (label, key, min, max, show, step) => slider(label, () => c.mask[key] ?? MASK_DEFAULT[key], (v) => { c.mask[key] = v; }, { min, max, step, def: MASK_DEFAULT[key], show });
      side.replaceChildren(head("Маска", m && (() => setShape("none"))),
        h("p.hint", {}, "Оставляет видимой только часть кадра этого клипа. Двигайте маску пальцем прямо на видео, двумя пальцами — размер."),
        h("div.tiles", {}, MASK_SHAPES.map(([k, n]) => h("button" + ((m ? m.shape : "none") === k ? ".on" : ""), { onclick: () => setShape(k) }, n))),
        ...(m ? [m.shape !== "line" && m.shape !== "band" ? msl("Ширина", "w", 0.05, 1.5) : null, m.shape !== "line" ? msl("Высота", "h", 0.03, 1.5) : null,
          m.shape === "rect" ? msl("Скругление углов", "round", 0, 1) : null,
          msl("Поворот", "rot", -180, 180, (v) => Math.round(v) + "°", 1), msl("Растушёвка края", "feather", 0, 0.5),
          h("button.check" + (m.invert ? ".on" : ""), { onclick: () => { begin(); c.mask.invert = !m.invert; renderPanel(); draw(); save(); } }, h("i", {}, m.invert ? icon("check", 14) : null), "Наоборот: закрыть то, что внутри")].filter(Boolean) : []));
    } else if (panel === "cloud") {
      const c = P.clouds.find((x) => x.id === cloudSel);
      const csl = (label, key, min, max, show) => slider(label, () => c[key] ?? CLOUD_DEFAULT[key], (v) => { c[key] = v; }, { min, max, def: CLOUD_DEFAULT[key], show });
      side.replaceChildren(head("Облако"),
        h("p.hint", {}, "Мягкое затемнение, чтобы текст читался на любом фоне. Живёт на своей дорожке: его можно двигать по времени, растягивать за края и удалять."),
        h("button.btn.primary.wide", { onclick: addCloud }, icon("plus", 18), "Добавить облако здесь"),
        ...(c ? [h("p.hint", {}, "Двигайте облако пальцем прямо на видео, двумя пальцами — размер."),
          csl("Плотность", "a", 0.05, 1), csl("Ширина", "w", 0.1, 1.6), csl("Высота", "h", 0.03, 1.2), csl("Мягкость края", "soft", 0.05, 1),
          csl("Плавное появление", "fade", 0, 1.5, (v) => v.toFixed(2).replace(".", ",") + " с"),
          h("div.sl-top", {}, "Цвет"), colorPicker(() => c.color || "#000000", (v) => { c.color = v; draw(); save(); }, begin),
          h("button.btn.wide.danger", { onclick: removeCloud }, "Удалить облако")]
          : [P.clouds.length ? h("p.hint", {}, "Чтобы изменить облако, нажмите на него на дорожке внизу.") : null].filter(Boolean)));
    } else if (panel === "sound") {
      side.replaceChildren(head("Звук"),
        slider("Громкость", () => P.volume, (v) => { P.volume = v; setVolume(); }, { min: 0, max: 2, def: 1, show: (v) => Math.round(v * 100) + " %" }),
        h("p.hint", {}, "Громче 100 % слышно в готовом видео; в превью звук не усиливается."));
    }
  }
  // кадр пальцами на превью
  const ptrs = new Map(); let g0 = null;
  canvas.addEventListener("pointerdown", (e) => {
    const cl = panel === "cloud" && P.clouds.find((x) => x.id === cloudSel);
    const mk = panel === "mask" && target()?.mask;
    const mode = panel === "frame" ? "frame" : mk ? "mask" : cl ? "cloud" : panel === "subs" && P.subs?.on && lines.length ? "subs" : null;
    if (!mode) { if (ptrs.size === 0) toggle(); return; }
    const c = mode === "frame" ? target() : null; if (mode === "frame" && !c) return;
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e);
    if (mode === "frame" && ptrs.size === 1) begin();
    const ps = [...ptrs.values()], d = ps[1] ? Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY) : 0;
    if (mode === "frame") g0 = { mode, c, fr: { ...(c.frame ||= { ...FRAME_DEFAULT }) }, x: ps[0].clientX, y: ps[0].clientY, d };
    else if (mode === "mask") g0 = { mode: "cloud", cl: mk, s0: { x: mk.x ?? 0.5, y: mk.y ?? 0.5, w: mk.w ?? MASK_DEFAULT.w, h: mk.h ?? MASK_DEFAULT.h }, x: ps[0].clientX, y: ps[0].clientY, d, moved: g0?.moved || false };
    else if (mode === "cloud") g0 = { mode, cl, s0: { x: cl.x, y: cl.y, w: cl.w, h: cl.h }, x: ps[0].clientX, y: ps[0].clientY, d, moved: g0?.moved || false };
    else { const st = subApi.cur(); g0 = { mode, s0: { x: st.x, y: st.y, size: st.size }, x: ps[0].clientX, y: ps[0].clientY, d, moved: g0?.moved || false }; }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId) || !g0) return;
    ptrs.set(e.pointerId, e);
    const ps = [...ptrs.values()], r = canvas.getBoundingClientRect(), k = ps.length >= 2 && g0.d ? Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY) / g0.d : 0;
    const dx = (ps[0].clientX - g0.x) / r.width, dy = (ps[0].clientY - g0.y) / r.height;
    if (g0.mode === "frame") {
      const fr = g0.c.frame;
      if (k) fr.scale = clamp(g0.fr.scale * k, 0.2, 4); else { fr.x = clamp(g0.fr.x + dx, -1, 1); fr.y = clamp(g0.fr.y + dy, -1, 1); }
    } else if (g0.mode === "cloud") {
      if (!g0.moved) { if (!k && Math.hypot(dx * r.width, dy * r.height) < 5) return; g0.moved = true; pause(); begin(); }
      const c = g0.cl;
      if (k) { c.w = clamp(g0.s0.w * k, 0.1, 1.6); c.h = clamp(g0.s0.h * k, 0.03, 1.2); }
      else { const x = clamp(g0.s0.x + dx, 0, 1); c.x = Math.abs(x - 0.5) < 0.02 ? 0.5 : x; c.y = clamp(g0.s0.y + dy, 0, 1); }
    } else {
      if (!g0.moved) { if (!k && Math.hypot(dx * r.width, dy * r.height) < 5) return; g0.moved = true; pause(); begin(); }
      const st = subApi.st();
      if (k) st.size = clamp(g0.s0.size * k, 0.025, 0.2);
      else if (subApi.scope() !== "word") { const x = clamp(g0.s0.x + dx, 0.05, 0.95); st.x = Math.abs(x - 0.5) < 0.02 ? 0.5 : x; st.y = clamp(g0.s0.y + dy, 0.05, 0.95); }
    }
    draw();
  });
  const up = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    const g = g0; if (!ptrs.size) g0 = null;
    if (ptrs.size) return;
    if ((g?.mode === "subs" || g?.mode === "cloud") && !g.moved) return toggle();
    renderPanel(); save();
  };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);

  const onKey = (e) => {
    if (e.target.closest("input, textarea") || document.querySelector(".backdrop")) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.key === "Backspace" || e.key === "Delete") remove();
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? restore(redo, undo) : restore(undo, redo); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") { e.preventDefault(); split(); }
  };
  document.addEventListener("keydown", onKey);
  function exit() {
    pause(); clearTimeout(saveT); clearTimeout(pushT); clearInterval(remoteTimer);
    if (dirty && cloud.signedIn()) pushProject({ ...P, updated: Date.now() }).catch(() => {});
    alive = false; ro.disconnect(); offMedia(); document.removeEventListener("keydown", onKey);
    for (const r of vids.values()) { r.v.src = ""; r.v.remove(); }
    P.updated = Date.now(); P.duration = total();
    db.put("projects", P).finally(onExit);
  }

  layout(); fit(); syncBar();
  if (P.clips.length) pps = clamp((scroll.clientWidth * 0.8) / Math.max(1, total()), 3, 240);
  await loadAll();
  // для автопроверок
  window.__ed = { P, seek, checkRemote, push, get cloudSel() { return cloudSel; }, get lines() { return lines; }, subApi, get t() { return t; }, get playing() { return playing; }, total };
}
