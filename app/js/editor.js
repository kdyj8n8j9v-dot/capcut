// Редактор: превью, таймлайн (резка, обрезка краёв, перестановка), кадр, цвет, звук.
import { h, icon, sheet, toast, ask, askText, fmtTime, clamp } from "./ui.js";
import { db, uid, settings } from "./store.js";
import { createRenderer, GRADE_DEFAULT, FRAME_DEFAULT, HSL_BANDS } from "./gl.js";
import { mediaUrl, mediaBlob, library, ensure, onMedia, busyOf, ensureWords, imageUrl, ensureImage, audioUrl, ensureAudio } from "./media.js";
import { drawOverlays, ovAt, OV_DEFAULT, OV_IN, OV_OUT, OV_LOOP } from "./overlays.mjs";
import { buildLines, drawSubs, drawClouds, drawMaskCached, drawTransitions, TRANSITIONS, textLines, TEXT_DEFAULT, normStyle, PRESETS, CLOUD_DEFAULT, MASK_DEFAULT, MASK_SHAPES } from "./subs.mjs";
import { useFont } from "./fonts.js";
import { subsPanel, openLine, openSubsTab, colorPicker } from "./subsui.js";
import { cloud } from "./cloud.js";
import { openLibrary, openOverlayPicker, openSoundPicker } from "./library.js";
import { openExport } from "./export.js";
import { LOOKS, scaleLook } from "./looks.js";
import { favStar, favSort, easePicker, mine } from "./fav.js";
import { CURVES, clipLen, srcAt, outAt, rateAt, splitCurve, speedAt, VMIN, VMAX } from "./speed.mjs";
import { pushProject, remoteNewer } from "./sync.js";
import { openFast, Stream } from "./fastplay.mjs";

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
  P.clips ||= []; P.media ||= {}; P.grade ||= {}; P.format ||= "9:16"; P.volume ??= 1; P.words ||= {}; P.clouds ||= []; P.overlays ||= []; P.images ||= {}; P.sounds ||= []; P.audios ||= {}; P.texts ||= []; P.voice ||= {};
  const root = document.getElementById("app");
  let t = 0, sel = null, pps = 40, playing = false, pi = 0, panel = null, alive = true, lastTick = 0;
  const undo = [], redo = [];
  const vids = new Map();     // key → { v, w, h, ok }
  const thumbs = new Map();   // key → [{ t, c }]
  const out = () => FORMATS[P.format] || FORMATS["9:16"];
  const sp = (c) => c.speed || 1, len = clipLen;   // длина на таймлайне с учётом скорости и кривой
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
  // кадр, скорость, маску меняем у выбранного клипа, а если ничего не выбрано — у того, что сейчас на экране
  const target = () => (sel && P.clips.find((c) => c.id === sel)) || locate(t)?.clip || null;
  let shown = null;

  // ——— история и сохранение
  const snap = () => JSON.stringify({ clips: P.clips, grade: P.grade, format: P.format, volume: P.volume, subs: P.subs || null, words: P.words, clouds: P.clouds, overlays: P.overlays, images: P.images, sounds: P.sounds, audios: P.audios, texts: P.texts, voice: P.voice });
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
      Object.assign(P, r); P.clips ||= []; P.media ||= {}; P.grade ||= {}; P.words ||= {}; P.clouds ||= []; P.overlays ||= []; P.images ||= {}; P.sounds ||= []; P.audios ||= {}; P.texts ||= []; P.voice ||= {};
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
  const fullBtn = h("button.chip.full-btn", { onclick: () => setFull(true), "aria-label": "На весь экран" }, icon("expand", 18));
  // полноэкранный просмотр: только видео и простые кнопки внизу (сами прячутся во время воспроизведения)
  const fsPlay = h("button.round.fs-play", { onclick: (e) => { e.stopPropagation(); toggle(); fsShow(); }, "aria-label": "Пуск или пауза" }, icon("play", 22));
  const fsTime = h("span.fs-time", {}, "0:00");
  const fsSeek = h("input.fs-seek", { type: "range", min: 0, max: 1, step: 0.01, value: 0, "aria-label": "Перемотка",
    oninput: (e) => { e.stopPropagation(); pause(); seek(+fsSeek.value); fsShow(); } });
  const fsCtl = h("div.fs-ctl", { onclick: (e) => e.stopPropagation() }, fsPlay, fsTime, fsSeek,
    h("button.chip", { onclick: (e) => { e.stopPropagation(); setFull(false); } }, icon("shrink", 16), "Свернуть"));
  const view = h("div.view", {}, canvas, over, guides, empty, guideBtn, fullBtn, fsCtl);
  const side = h("aside.panel", { hidden: true });
  const tNow = h("span.t-now", {}, "0:00,0"), tAll = h("span.t-all", {}, "0:00");
  const playBtn = h("button.round.play", { onclick: toggle, "aria-label": "Пуск" }, icon("play", 22));
  const scroll = h("div.tl-scroll"), ruler = h("div.tl-ruler"), track = h("div.tl-track"), subRow = h("div.tl-subs"), cloudRow = h("div.tl-clouds"), ovRow = h("div.tl-ovs"), sndRow = h("div.tl-snds"), txtRow = h("div.tl-txts"), inner = h("div.tl-inner", {}, ruler, track, ovRow, txtRow, subRow, cloudRow, sndRow);
  scroll.append(inner);
  const titleBtn = h("button.title", { onclick: rename }, P.name);
  const fmtBtn = h("button.chip", { onclick: pickFormat, "aria-label": "Формат" }, P.format);
  const undoBtn = h("button.round", { onclick: () => restore(undo, redo), "aria-label": "Отменить" }, icon("undo", 20));
  const redoBtn = h("button.round", { onclick: () => restore(redo, undo), "aria-label": "Вернуть" }, icon("redo", 20));
  const tool = (id, ic, label, fn) => h("button.tool", { "data-tool": id, onclick: fn }, icon(ic), h("span", {}, label));
  // нижняя строка как в CapCut: без выбора — что добавить в ролик; выбран клип — всё, что можно сделать с ним
  const tools = h("nav.tools", {},
    tool("quick", "magic", "Быстро", () => openPanel("quick")), tool("media", "plus", "Медиа", addMedia), tool("clip", "crop", "Клип", pickClip),
    tool("text", "type", "Текст", () => openPanel("text")), tool("subs", "text", "Субтитры", () => openPanel("subs")), tool("sound", "sound", "Звук", () => openPanel("sound")), tool("overlay", "layers", "Наложение", () => openPanel("overlay")),
    tool("color", "color", "Цвет", () => openPanel("color")), tool("cloud", "cloud", "Облако", () => openPanel("cloud")));
  const clipBar = h("nav.tools.clipbar", { hidden: true },
    tool("back", "back", "Назад", unselect), tool("c-split", "split", "Разрезать", split),
    tool("speed", "speed", "Скорость", () => openPanel("speed")), tool("frame", "crop", "Кадр", () => openPanel("frame")), tool("mask", "mask", "Маска", () => openPanel("mask")),
    tool("transition", "transition", "Переход", clipTransition), tool("c-dup", "copy", "Копия", duplicate), tool("color", "color", "Цвет", () => openPanel("color")), tool("c-delete", "trash", "Удалить", remove));
  const CLIP_PANELS = new Set(["frame", "speed", "mask", "transition"]);
  const acts = h("div.acts", {}, h("button.round.act", { "data-tool": "split", onclick: split, "aria-label": "Разрезать" }, icon("split", 20)), h("button.round.act.act-del", { "data-tool": "delete", onclick: remove, "aria-label": "Удалить" }, icon("trash", 18)));
  const ed = h("div.ed", {},
    h("header.bar", {},
      h("button.link", { onclick: exit }, icon("back", 20), "Проекты"), titleBtn,
      h("div.bar-right", {}, undoBtn, redoBtn, fmtBtn, h("button.btn.primary", { onclick: doExport }, icon("share", 18), "Экспорт"))),
    h("div.stage", {}, view, side),
    h("div.transport", {}, h("div.times", {}, tNow, h("span.muted", {}, " / "), tAll), playBtn,
      h("div.zoom", {}, acts, h("button.round", { onclick: () => zoom(1 / 1.5), "aria-label": "Мельче" }, icon("zoomout", 18)),
        h("button.round", { onclick: () => zoom(1.5), "aria-label": "Крупнее" }, icon("zoomin", 18)))),
    h("div.tl", {}, h("div.tl-grab", { title: "Потяните, чтобы изменить высоту дорожек" }), scroll, h("div.tl-head")),
    tools, clipBar);
  root.replaceChildren(ed);

  function syncBar() {
    undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
    const none = !P.clips.length;
    empty.hidden = !none; canvas.hidden = over.hidden = guideBtn.hidden = fullBtn.hidden = none;
    fsPlay.replaceChildren(icon(playing ? "pause" : "play", 22)); fsUpd();
    if (full) { if (playing) fsHide(); else fsShow(true); }
    const clipMode = !!sel && (!panel || CLIP_PANELS.has(panel) || panel === "color");
    tools.hidden = clipMode; clipBar.hidden = !clipMode;
    const bar = clipMode ? clipBar : tools;
    for (const b of [...bar.children, ...acts.children]) {
      const id = b.dataset.tool;
      if (bar === clipBar && id !== "delete") { b.disabled = false; b.classList.toggle("on", id === panel); continue; }
      b.disabled = id !== "media" && none || id === "delete" && !sel && !(panel === "cloud" && cloudSel) && !(panel === "overlay" && ovSel) && !(panel === "sound" && sndSel) && !(panel === "text" && txtSel);
      b.classList.toggle("on", id === panel);
      if (id === panel && b.scrollIntoView && bar.scrollWidth > bar.clientWidth) b.scrollIntoView({ block: "nearest", inline: "nearest" });
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
    over.style.width = cw + "px"; over.style.height = ch + "px";
    sizeVids(cw, ch); over.width = canvas.width; over.height = canvas.height;
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
    tlSettle();
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
  let vw = 2, vh = 2;
  function sizeVids(w = vw, h = vh) { vw = w; vh = h; for (const v of view.querySelectorAll("video.src")) { v.style.width = w + "px"; v.style.height = h + "px"; } }
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
    // счётчик новых кадров: пока видео играет, превью перерисовывает картинку только с новым кадром
    rec.frame = 0;
    // и отметка каждого показанного кадра: какой кадр исходника (mediaTime) и когда он на экране — по ней идут часы
    if (v.requestVideoFrameCallback) {
      rec.rvfc = true;
      const onF = (n, m) => { rec.frame++; if (!v.paused && !v.seeking && m) { rec.mt = m.mediaTime; rec.mw = m.expectedDisplayTime || n; } v.requestVideoFrameCallback(onF); };
      v.requestVideoFrameCallback(onF);
    }
    // видео — настоящего размера прямо под картинкой превью (её закрывает холст). Раньше оно было 2×2 точки и прозрачным:
    // Safari такое видео считает невидимым и отдаёт меньше кадров (замер на iPad: 20 к/с вместо 30)
    v.src = url; rec.url = url; view.prepend(v); sizeVids();
    loadFast(key, rec);
    return rec;
  }
  // быстрый путь воспроизведения: кадры — из декодера WebCodecs, звук — отдельный <audio> (см. fastplay.mjs)
  async function loadFast(key, rec) {
    const url = rec.url, f = await openFast(await mediaBlob(key).catch(() => null));
    if (!f || rec.url !== url || !alive) return;
    if (rec.stream) rec.stream.stop();
    rec.fast = f; rec.stream = null;
    if (f.audio) {
      const a = rec.a || new Audio();
      a.preload = "auto"; a.preservesPitch = true; a.src = url; rec.a = a;
      a.volume = clamp(P.volume, 0, 1); a.muted = P.volume <= 0;
    } else rec.a = null;
  }
  function startFast(rec, c, local) {
    const src = Math.min(srcAt(c, local), c.out - 0.001);
    // подготовленный на паузе поток с того же места — берём его (пуск без задержки на декодирование)
    if (!(rec.stream && rec.stream.alive && !rec.stream.cur && Math.abs(rec.stream.start - src) < 0.02)) {
      if (rec.stream) rec.stream.stop();
      rec.stream = new Stream(rec.fast, src);
    }
    rec.vt = undefined; rec.rateT = 0;
    if (rec.a) { rec.a.currentTime = src; setRate(rec.a, rateAt(c, local)); rec.a.play().catch(() => {}); }
  }
  // новый способ (WebCodecs) — по переключателю в «Настройках»: на проверке в Chrome прежний способ вышел ровнее
  function fastOn(rec) { return !!rec.fast && !rec.fastOff && !window.__noFast && (!!settings.get("fastplay") || !!window.__fastplay); }
  function stopFast(rec) { if (rec.stream) { if (rec.stream.cur) rec.hold = rec.stream.cur; rec.stream.stop(); } if (rec.a) rec.a.pause(); }
  async function loadAll() {
    await Promise.all(Object.keys(P.media).map(video));
    P.overlays.forEach(loadOv); P.sounds.forEach(loadSnd);
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
  const offMedia = onMedia(() => { if (alive) { for (const k of Object.keys(P.media)) if (!vids.has(k)) video(k).then((r) => r && layout()); else swapLight(k); layoutBusy(); } });
  // пришла лёгкая копия (1080p) вместо тяжёлого оригинала с устройства — превью переходит на неё: iPad не тянет 4K, особенно на ускорении
  async function swapLight(k) {
    const r = vids.get(k), url = await mediaUrl(k);
    if (!r || !url || r.url === url || playing) return;
    r.url = url; r.ok = false; r.v.src = url; r.fast = null; loadFast(k, r);
  }

  function draw() {
    if (!R || !alive) return;
    const loc = locate(t), rec = loc && vids.get(loc.clip.media);
    const D = window.__perfD, q = () => D && performance.now(), a0 = q();
    // кадр декодера: при воспроизведении — текущий; сразу после паузы, пока видео-элемент ищет точный кадр, — последний показанный
    const fz = !rec || !rec.ok ? null : playing ? (fastOn(rec) ? rec.stream?.cur : null) : rec.v.seeking ? rec.hold : null;
    if (fz) R.draw(fz.canvas, rec.w, rec.h, out(), loc.clip.frame, P.grade, fz.timestamp);
    else if (rec && rec.ok) R.draw(rec.v, rec.w, rec.h, out(), loc.clip.frame, P.grade, playing && rec.rvfc ? rec.frame : null);
    else R.draw(null);
    const a1 = q();
    const c2 = over.getContext("2d");
    c2.clearRect(0, 0, over.width, over.height);
    drawMaskCached(c2, over.width, over.height, loc && loc.clip.mask, newCv);
    poolN = 0; drawOverlays(c2, over.width, over.height, t, P.overlays, ovSource, makeCv, newCv);
    drawTransitions(c2, over.width, over.height, t, trList());
    drawClouds(c2, over.width, over.height, t, P.clouds);
    const a2 = q();
    if (P.subs?.on && lines.length) drawSubs(c2, over.width, over.height, t, lines, subStyle());
    const a3 = q();
    if (P.texts.length) drawSubs(c2, over.width, over.height, t, tlines(), {});
    if (D) D.push([a1 - a0, a2 - a1, a3 - a2, q() - a3]);
  }
  function seek(time, fromScroll) {
    t = clamp(time, 0, total());
    const loc = locate(t);
    for (const [k, r] of vids) if (!loc || k !== loc.clip.media) r.v.pause();
    if (loc) {
      const rec = vids.get(loc.clip.media);
      if (rec && rec.ok) {
        const want = Math.min(srcAt(loc.clip, loc.local), loc.clip.out - 0.001);
        setRate(rec.v, rateAt(loc.clip, loc.local));
        if (Math.abs(rec.v.currentTime - want) > 0.005) rec.v.currentTime = want;
      }
    }
    if (!fromScroll) tlSettle();
    tNow.textContent = fmtTime(t, true);
    syncOv(); syncSnd();
    draw();
    if (!playing) prime();
    if ((panel === "frame" || panel === "mask" || panel === "speed") && loc?.clip.id !== shown && !ptrs.size && !sel) renderPanel();
    if (panel === "speed" && curveHook && side.querySelector("canvas.curve")) curveHook();
  }
  // скорость видео меняем, только если она заметно другая: частые смены на iPad останавливают картинку и звук
  // меняем скорость, только если она разошлась с нужной больше чем на tol: каждая смена в Safari на миг останавливает
  // видео и звук (замер на iPad: на кривой время стояло 19 раз в секунду, на 1× — 1 раз)
  let rateN = 0;
  function setRate(v, r, tol = 0.04) { r = clamp(r, 0.0625, 16); if (Math.abs(v.playbackRate - r) > r * tol) try { v.playbackRate = r; rateN++; } catch {} }
  // на паузе заранее готовим поток кадров с текущего места: по ▶ первый кадр уже декодирован
  let primeT = 0;
  function prime() {
    clearTimeout(primeT);
    primeT = setTimeout(() => {
      if (playing) return;
      const loc = locate(t), rec = loc && vids.get(loc.clip.media);
      if (!rec || !fastOn(rec)) return;
      const src = Math.min(srcAt(loc.clip, loc.local), loc.clip.out - 0.001);
      if (rec.stream && rec.stream.alive && !rec.stream.cur && Math.abs(rec.stream.start - src) < 0.02) return;
      if (rec.stream) rec.stream.stop();
      rec.stream = new Stream(rec.fast, src);
    }, 150);
  }
  function setVolume() { for (const r of vids.values()) for (const m of [r.v, r.a]) if (m) { m.volume = clamp(P.volume, 0, 1); m.muted = P.volume <= 0; } }
  function play() {
    if (!P.clips.length) return;
    if (t >= total() - 0.05) seek(0);
    const loc = locate(t);
    pi = loc.i; playing = true; lastTick = performance.now();
    setVolume();
    // iPad/iPhone: каждое видео должно быть запущено касанием хотя бы раз
    for (const [k, r] of vids) if (k !== loc.clip.media && !r.unlocked) { r.unlocked = true; const p = r.v.play(); p && p.then(() => { if (!playing || P.clips[pi]?.media !== k) r.v.pause(); }).catch(() => {}); }
    const rec = vids.get(loc.clip.media);
    // iPad: звук каждого <audio> тоже надо один раз запустить касанием
    for (const [k, r] of vids) if (r.a && !r.aUnlocked && k !== loc.clip.media) { r.aUnlocked = true; const p = r.a.play(); p && p.then(() => { if (!playing || P.clips[pi]?.media !== k) r.a.pause(); }).catch(() => {}); }
    if (rec && fastOn(rec)) { rec.unlocked = rec.aUnlocked = true; rec.v.pause(); startFast(rec, loc.clip, loc.local); }
    else if (rec) { rec.unlocked = true; rec.vt = undefined; rec.mt = null; rec.rateT = 0; setRate(rec.v, rateAt(loc.clip, loc.local)); rec.v.play().catch(() => {}); }
    for (const [id, r] of ovVids) if (!r.unlocked) { r.unlocked = true; const p = r.v.play(); p && p.then(() => syncOv()).catch(() => {}); }
    for (const a of sndEls.values()) if (a.el && !a.unlocked) { a.unlocked = true; const p = a.el.play(); p && p.then(() => syncSnd()).catch(() => {}); }
    syncOv(); syncSnd();
    syncBar(); requestAnimationFrame(tick);
  }
  function pause() {
    stopAt = null; if (!playing) return; playing = false; tlSettle();
    for (const r of vids.values()) { r.v.pause(); stopFast(r); r.fastOff = false; r.lagMs = 0; }
    seek(t);   // видео-элемент встаёт на точный кадр паузы (пока он ищет — виден последний кадр декодера)
    syncOv(); syncSnd(); syncBar(); for (const k of vids.keys()) swapLight(k);
  }
  function toggle() { playing ? pause() : play(); }
  // таймлайн при воспроизведении едет как картинка на видеочипе (transform), а не прокруткой: на iPad прокрутку ведёт
  // отдельный системный процесс, и команда «прокрутить» каждый кадр давала рывки и отставание дорожки
  let flow = null;
  function tlMove() {
    if (!flow) { flow = { base: scroll.scrollLeft }; inner.style.willChange = "transform"; }
    inner.style.transform = `translate3d(${(flow.base - t * pps).toFixed(1)}px,0,0)`;
  }
  function tlSettle() {
    if (flow) { flow = null; inner.style.transform = ""; inner.style.willChange = ""; }
    scroll.scrollLeft = t * pps;
  }
  // замер плавности поверх видео (переключатель в «Настройках»): кадров экрана/с, новых кадров видео/с, отставание
  // картинки от таймлайна, сколько раз время стояло, способ и размер источника — владелец присылает эти цифры
  const hud = settings.get("perfhud") ? h("div.hud") : null;
  if (hud) view.append(hud);
  let hs = null;
  function hudTick(now, c, rec, fast) {
    if (!hs || now - hs.t0 > 1000) {
      if (hs) hud.textContent = `экран ${hs.n} к/с · видео ${hs.vf} к/с · время стояло ${hs.st} · отставание ${Math.round(hs.lag * 1000)} мс · ` +
        `рисование ${(hs.dr / Math.max(1, hs.n)).toFixed(1).replace(".", ",")} мс · смен скорости ${rateN - hs.r0} · ${fast ? "WebCodecs" : "плеер"}${rec?.stream?.err ? " (WebCodecs, " + rec.stream.err + ")" : ""} · ` +
        `${rec ? rec.w + "×" + rec.h : "нет видео"} · ${String(rateAt(c, t - startOf(pi)).toFixed(2)).replace(".", ",")}×`;
      hs = { t0: now, n: 0, vf: 0, st: 0, lag: 0, dr: 0, r0: rateN, lastT: t, lastF: null };
    }
    hs.n++;
    const f = fast ? rec.stream.cur?.timestamp : rec?.frame;
    if (f !== hs.lastF) { hs.vf++; hs.lastF = f; }
    if (t === hs.lastT) hs.st++; hs.lastT = t;
    if (rec && rec.ok) { const have = fast ? (rec.stream.cur ? rec.stream.cur.timestamp - rec.fast.off : null) : (rec.mt != null ? rec.mt : rec.v.currentTime); /* отметка показанного кадра точнее currentTime */ if (have != null) hs.lag = Math.max(hs.lag, srcAt(c, t - startOf(pi)) - have); }
  }
  function tick(now) {
    if (!playing || !alive) return;
    const c = P.clips[pi], rec = c && vids.get(c.media), dt = (now - lastTick) / 1000; lastTick = now;
    if (!c) return pause();
    let local;
    // Главное — само видео со звуком: оно играет подряд и во время воспроизведения НИКОГДА не перематывается
    // (каждая перемотка рвёт звук на «слоги» и даёт скачки кадров). Таймлайн и субтитры плавно идут за видео:
    // между редкими обновлениями времени видео время досчитывается по часам, назад не идёт и не прыгает.
    // Не успевает устройство — таймлайн чуть притормозит, но кадры и звук идут подряд.
    const step = Math.min(dt, 0.1), prev = t - startOf(pi);
    const fast = rec && rec.ok && fastOn(rec) && rec.stream;
    const clk = rec && rec.ok ? (fast ? rec.a : rec.v) : null;   // по чему идёт время: звук быстрого пути или видео
    if (fast && !rec.stream.cur && !rec.stream.ready(srcAt(c, prev))) local = prev;   // декодер ещё не дал первый кадр — ждём
    else if (clk) {
      const v = clk, vt = v.currentTime;
      // на кривой скорость меняем не чаще 3 раз в секунду и только при расхождении больше 12 %; таймлайн всё равно
      // считается по точному месту в видео (outAt), так что субтитры не разъезжаются — чуть неточна лишь сама скорость
      if (now - (rec.rateT || 0) > 330) { rec.rateT = now; setRate(v, rateAt(c, prev), 0.12); }
      if (vt !== rec.vt) { rec.vt = vt; rec.vWall = now; rec.vLocal = outAt(c, vt); }
      const moving = !v.paused && !v.seeking && v.readyState >= 3;
      let est;
      if (!fast && rec.mt != null && moving) {
        // по отметке показанного кадра: сколько прошло с его показа × скорость видео, но не дальше ~1,5 кадра —
        // время не убегает вперёд картинки (раньше убегало до 0,4 с исходника и потом стояло, ожидая видео)
        const ahead = clamp((now - rec.mw) / 1000, 0, 0.05) * v.playbackRate;
        est = outAt(c, Math.min(rec.mt + ahead, c.out));
      } else est = rec.vLocal + (moving ? Math.min((now - rec.vWall) / 1000, 0.05) : 0);
      // плавные часы: каждый кадр экрана время идёт на столько, сколько прошло (с учётом скорости видео и кривой),
      // а по отметке показанного кадра лишь мягко подправляется (≤60 % шага) — не стоит и не уходит от картинки.
      // (раньше «догоняли» отметку: новый кадр приходил с отметкой ≈ прошлой оценке, и время стояло — замер iPad: 7–14 раз/с)
      const nominal = step * v.playbackRate / Math.max(0.05, rateAt(c, prev)), err = est - prev;
      if (!moving) local = prev + Math.max(0, err);                  // видео стоит (догрузка) — ждём его
      else if (err > 0.25) local = est;                              // сильно позади видео (после старта) — сразу к нему
      else local = prev + Math.max(0, nominal + clamp(err * 0.15, -0.6 * nominal, 0.6 * nominal));
      if (v.paused && !v.ended && !v.seeking && now - (rec.playT || 0) > 300) { rec.playT = now; v.play().catch(() => {}); }
    } else local = prev + step;   // нет копии — чёрный кадр, время идёт по часам
    // страховка: если декодер не успевает за звуком (кадр отстаёт больше 0,3 с исходника дольше 1,2 с) — до конца
    // этого воспроизведения переходим на прежний путь (плеер браузера), чтобы картинка не отставала
    if (fast && rec.stream.cur) {
      const lag = srcAt(c, local) - (rec.stream.cur.timestamp - rec.fast.off);
      rec.lagMs = lag > 0.3 ? (rec.lagMs || 0) + dt * 1000 : Math.max(0, (rec.lagMs || 0) - dt * 500);
      if (rec.lagMs > 1200) {
        rec.fastOff = true; rec.lagMs = 0; stopFast(rec); rec.hold = null;
        rec.v.currentTime = Math.min(srcAt(c, local), c.out - 0.001); setRate(rec.v, rateAt(c, local)); rec.vt = undefined; rec.v.play().catch(() => {});
      }
    }
    if (local >= len(c) - 0.015 || (clk && (clk.ended || clk.currentTime >= c.out - 0.02))) {
      if (rec) { rec.v.pause(); stopFast(rec); }
      pi++;
      if (pi >= P.clips.length) { playing = false; t = total(); tlSettle(); syncBar(); draw(); return; }
      const n = P.clips[pi], nr = vids.get(n.media);
      t = startOf(pi);
      if (nr && nr.ok && fastOn(nr)) startFast(nr, n, 0);
      else if (nr && nr.ok) { nr.vt = undefined; nr.mt = null; nr.rateT = 0; nr.v.currentTime = n.in; setRate(nr.v, rateAt(n, 0)); nr.v.play().catch(() => {}); }
    } else t = startOf(pi) + Math.max(0, local);
    const pf = window.__perf, p0 = pf && performance.now(), p0d = performance.now();
    tlMove();
    tNow.textContent = fmtTime(t, true);
    if (full) fsUpd();
    const p1 = pf && performance.now();
    syncOv(); syncSnd();
    const p2 = pf && performance.now();
    draw();
    if (pf) { const p3 = performance.now(); pf.push([p1 - p0, p2 - p1, p3 - p2, p0 - now]); }   // замер: прокрутка, синхронизация, рисование
    if (hud) { hs && (hs.dr += performance.now() - p0d); hudTick(now, c, rec, fast); }
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
    const rows = ruler.offsetHeight + track.offsetHeight + (subRow.hidden ? 0 : subRow.offsetHeight + 3) + (cloudRow.hidden ? 0 : cloudRow.offsetHeight + 3) + (ovRow.hidden ? 0 : ovRow.offsetHeight + 3) + (sndRow.hidden ? 0 : sndRow.offsetHeight + 3) + (txtRow.hidden ? 0 : txtRow.offsetHeight + 3);
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
  // ——— наложения: фото, стикеры и видео поверх основного; своя дорожка (этажи по слоям)
  let ovSel = null, odrag = null, ovTab = 0, poolN = 0;
  const ovVids = new Map(), ovImgs = new Map(), pool = [];
  const newCv = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const makeCv = (w, h) => { const c = pool[poolN] ||= document.createElement("canvas"); poolN++; c.width = w; c.height = h; return c; };
  const ovSize = (o) => { if (o.kind === "video") { const r = ovVids.get(o.id); return r && r.ok ? { w: r.w, h: r.h } : P.media[o.media] || null; } return P.images[o.image] || null; };
  function ovSource(o) {
    if (o.kind === "video") { const r = ovVids.get(o.id); return r && r.ok ? { img: r.v, w: r.w, h: r.h } : null; }
    const r = ovImgs.get(o.image); return r && r.img ? r : null;
  }
  async function loadOv(o) {
    if (o.kind === "video") {
      if (ovVids.has(o.id)) return;
      const r = { v: null, ok: false, w: 0, h: 0 }; ovVids.set(o.id, r);
      const url = await mediaUrl(o.media);
      if (!url) { ovVids.delete(o.id); return; }
      const v = h("video.src", { playsInline: true, preload: "auto", muted: true, crossOrigin: "anonymous" });
      v.muted = true; v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
      r.v = v;
      v.addEventListener("loadeddata", () => { r.ok = true; r.w = v.videoWidth; r.h = v.videoHeight; syncOv(); draw(); });
      v.addEventListener("seeked", draw);
      v.src = url; view.prepend(v); sizeVids();
    } else {
      if (ovImgs.has(o.image)) return;
      ovImgs.set(o.image, { loading: true });
      try {
        const url = (await imageUrl(o.image)) || (await ensureImage(o.image, P.images[o.image]));
        if (!url) throw 0;
        const img = new Image(); img.src = url; await img.decode();
        ovImgs.set(o.image, { img, w: img.naturalWidth, h: img.naturalHeight }); draw(); layoutOvs();
      } catch { ovImgs.delete(o.image); }
    }
  }
  // видео-наложения идут вместе с основным: на паузе стоят на нужном кадре, при воспроизведении — играют
  function syncOv() {
    for (const o of P.overlays) {
      if (o.kind !== "video") continue;
      const r = ovVids.get(o.id); if (!r || !r.ok) continue;
      const on = t >= o.start && t < o.end, want = (o.from || 0) + (t - o.start);
      if (!on) { if (!r.v.paused) r.v.pause(); continue; }
      if (playing) { if (r.v.paused) { r.v.currentTime = want; r.v.play().catch(() => {}); } else if (Math.abs(r.v.currentTime - want) > 0.25) r.v.currentTime = want; }
      else { if (!r.v.paused) r.v.pause(); if (Math.abs(r.v.currentTime - want) > 0.02) r.v.currentTime = want; }
    }
  }
  const freeLayer = (s, e, skip) => { for (let n = 0; ; n++) if (!P.overlays.some((o) => o !== skip && (o.layer | 0) === n && o.start < e && o.end > s)) return n; };
  function placeOverlay(o) {
    const tot = total(), len = Math.min(o.end - o.start, Math.max(0.5, tot));
    o.start = Math.max(0, Math.min(t, tot - len)); o.end = Math.min(tot, o.start + len);
    o.layer = freeLayer(o.start, o.end);
    P.overlays.push(o); ovSel = o.id; loadOv(o);
    if (panel !== "overlay") { panel = "overlay"; requestAnimationFrame(fit); }
    layoutOvs(); syncOv(); draw(); renderPanel(); syncBar(); save();
  }
  function addOverlayImage(rec) {
    begin(); pause();
    P.images[rec.key] = { name: rec.name, w: rec.w, h: rec.h, path: rec.path };
    const o = out(), fit0 = Math.min(0.6, 0.6 * (o.h / o.w) * (rec.w / rec.h));
    placeOverlay({ id: uid(), kind: "image", image: rec.key, start: 0, end: 3, ...OV_DEFAULT, scale: Math.round(fit0 * 100) / 100 });
  }
  function addOverlayVideo(rec) {
    begin(); pause();
    P.media[rec.key] = { name: rec.name, dur: rec.dur, w: rec.w, h: rec.h };
    placeOverlay({ id: uid(), kind: "video", media: rec.key, from: 0, start: 0, end: rec.dur, ...OV_DEFAULT, scale: 0.5, radius: 0.15 });
  }
  function removeOverlay() { begin(); P.overlays = P.overlays.filter((o) => o.id !== ovSel); const r = ovVids.get(ovSel); if (r && r.v) { r.v.src = ""; r.v.remove(); } ovVids.delete(ovSel); ovSel = null; layoutOvs(); draw(); renderPanel(); syncBar(); save(); }
  const ovName = (o) => (o.kind === "video" ? P.media[o.media]?.name : P.images[o.image]?.name) || "Наложение";
  function layoutOvs() {
    ovRow.style.width = total() * pps + "px"; ovRow.hidden = !P.overlays.length;
    const n = Math.max(0, ...P.overlays.map((o) => (o.layer | 0) + 1));
    ovRow.replaceChildren(...Array.from({ length: n }, (_, k) => h("div.orow", {}, P.overlays.filter((o) => (o.layer | 0) === n - 1 - k).map((o) => {
      const r = o.kind === "image" ? ovImgs.get(o.image) : null;
      return h("div.ov" + (o.id === ovSel ? ".sel" : "") + (o.kind === "video" ? ".vid" : ""), { "data-id": o.id, style: { left: o.start * pps + "px", width: Math.max(8, (o.end - o.start) * pps - 2) + "px", ...(r && r.img ? { backgroundImage: `url(${r.img.src})` } : {}) } },
        h("span", {}, icon(o.kind === "video" ? "film" : "photo", 12), ovName(o)), h("i.g.l", { "data-side": "l" }), h("i.g.r", { "data-side": "r" }));
    }))));
    autoTl(); reveal(ovRow.querySelector(".ov.sel"));
  }
  function selectOverlay(id) {
    ovSel = id; pause();
    const o = P.overlays.find((x) => x.id === id);
    if (o && (t < o.start || t >= o.end)) seek(o.start + Math.min(0.3, (o.end - o.start) / 2));
    if (panel !== "overlay") { panel = "overlay"; requestAnimationFrame(fit); }
    layoutOvs(); renderPanel(); syncBar();
  }
  ovRow.addEventListener("click", (e) => { const el = e.target.closest(".ov"); if (!el || ovRow.dataset.drag) return; e.stopPropagation(); selectOverlay(el.dataset.id); });
  ovRow.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".ov.sel"); if (!el || e.button > 0) return;
    const o = P.overlays.find((x) => x.id === el.dataset.id);
    e.preventDefault(); pause();
    odrag = { o, el, side: e.target.dataset.side || "m", x: e.clientX, s0: o.start, e0: o.end, f0: o.from || 0, id: e.pointerId, moved: false };
    ovRow.setPointerCapture(e.pointerId);
  });
  ovRow.addEventListener("pointermove", (e) => {
    if (!odrag || e.pointerId !== odrag.id) return;
    const d = (e.clientX - odrag.x) / pps, o = odrag.o, tot = total(), len = odrag.e0 - odrag.s0;
    if (!odrag.moved) { if (Math.abs(e.clientX - odrag.x) < 4) return; odrag.moved = true; begin(); }
    const vid = o.kind === "video", dur = vid ? (P.media[o.media]?.dur || 1e9) : 1e9;
    if (odrag.side === "l") {   // левый край: у видео сдвигается и точка начала в исходнике
      const lo = vid ? Math.max(0, odrag.s0 - odrag.f0) : 0;
      o.start = clamp(odrag.s0 + d, lo, o.end - 0.2); if (vid) o.from = odrag.f0 + (o.start - odrag.s0);
    } else if (odrag.side === "r") o.end = clamp(odrag.e0 + d, o.start + 0.2, Math.min(tot, o.start + dur - (o.from || 0)));
    else { o.start = clamp(odrag.s0 + d, 0, Math.max(0, tot - len)); o.end = o.start + len; }
    odrag.el.style.left = o.start * pps + "px"; odrag.el.style.width = Math.max(8, (o.end - o.start) * pps - 2) + "px";
    syncOv(); draw();
  });
  const odragEnd = (e) => { if (!odrag || e.pointerId !== odrag.id) return; const m = odrag.moved; odrag = null; if (m) { ovRow.dataset.drag = "1"; setTimeout(() => delete ovRow.dataset.drag, 60); layoutOvs(); syncOv(); draw(); save(); } };
  ovRow.addEventListener("pointerup", odragEnd); ovRow.addEventListener("pointercancel", odragEnd);

  // ——— музыка и звуки: своя дорожка внизу; в превью играют вместе с видео, в готовом видео — смешиваются сборщиком
  let sndSel = null, sdragS = null;
  const sndEls = new Map();
  async function loadSnd(x) {
    if (sndEls.has(x.id)) return;
    const r = { el: null, ok: false }; sndEls.set(x.id, r);
    try {
      const url = (await audioUrl(x.audio)) || (await ensureAudio(x.audio, P.audios[x.audio]));
      if (!url) throw 0;
      const a = new Audio(); a.preload = "auto"; a.src = url; r.el = a;
      a.addEventListener("loadedmetadata", () => { r.ok = true; syncSnd(); });
    } catch { sndEls.delete(x.id); }
  }
  // громкость звука в момент t: своя громкость, плавные начало и конец, приглушение под голос (если есть субтитры)
  function sndGain(x) {
    let g = x.mute ? 0 : x.volume ?? 1;
    const fi = x.fadeIn || 0, fo = x.fadeOut || 0;
    if (fi > 0) g *= clamp((t - x.start) / fi, 0, 1);
    if (fo > 0) g *= clamp((x.end - t) / fo, 0, 1);
    if (x.duck && lines.some((l) => t >= l.start && t < l.end - 0.3)) g *= 0.3;
    return clamp(g, 0, 1);
  }
  function syncSnd() {
    for (const x of P.sounds) {
      const r = sndEls.get(x.id); if (!r || !r.ok) continue;
      const a = r.el, on = t >= x.start && t < x.end, want = (x.from || 0) + (t - x.start);
      if (!on || !playing) { if (!a.paused) a.pause(); if (on && Math.abs(a.currentTime - want) > 0.05) a.currentTime = want; continue; }
      a.volume = sndGain(x);
      if (a.paused) { a.currentTime = want; a.play().catch(() => {}); } else if (Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
    }
  }
  const freeSndLayer = (s, e) => { for (let n = 0; ; n++) if (!P.sounds.some((x) => (x.layer | 0) === n && x.start < e && x.end > s)) return n; };
  function addSound(rec) {
    begin(); pause();
    P.audios[rec.key] = { name: rec.name, dur: rec.dur, path: rec.path };
    const tot = total(), start = Math.max(0, Math.min(t, tot - 0.3)), end = Math.min(tot, start + rec.dur);
    const music = rec.dur > 20, x = { id: uid(), audio: rec.key, from: 0, start, end, volume: music ? 0.35 : 1, fadeIn: music ? 1 : 0, fadeOut: music ? 1.5 : 0, duck: music };
    x.layer = freeSndLayer(start, end);
    P.sounds.push(x); sndSel = x.id; loadSnd(x);
    if (panel !== "sound") { panel = "sound"; requestAnimationFrame(fit); }
    layoutSnds(); renderPanel(); syncBar(); save();
  }
  function removeSound() { begin(); const r = sndEls.get(sndSel); if (r && r.el) { r.el.pause(); r.el.src = ""; } sndEls.delete(sndSel); P.sounds = P.sounds.filter((x) => x.id !== sndSel); sndSel = null; layoutSnds(); renderPanel(); syncBar(); save(); }
  const sndName = (x) => P.audios[x.audio]?.name || "Звук";
  function layoutSnds() {
    sndRow.style.width = total() * pps + "px"; sndRow.hidden = !P.sounds.length;
    const n = Math.max(0, ...P.sounds.map((x) => (x.layer | 0) + 1));
    sndRow.replaceChildren(...Array.from({ length: n }, (_, k) => h("div.orow", {}, P.sounds.filter((x) => (x.layer | 0) === k).map((x) => {
      const len = x.end - x.start, fi = Math.min(len, x.fadeIn || 0), fo = Math.min(len, x.fadeOut || 0);
      return h("div.sn" + (x.id === sndSel ? ".sel" : "") + (x.duck ? ".duck" : ""), { "data-id": x.id, style: { left: x.start * pps + "px", width: Math.max(8, len * pps - 2) + "px" } },
        fi > 0 ? h("i.fin", { style: { width: fi * pps + "px" } }) : null, fo > 0 ? h("i.fout", { style: { width: fo * pps + "px" } }) : null,
        h("span", {}, icon("sound", 12), sndName(x) + (x.volume != null && x.volume !== 1 ? ` · ${Math.round(x.volume * 100)} %` : "")),
        h("i.g.l", { "data-side": "l" }), h("i.g.r", { "data-side": "r" }));
    }))));
    autoTl(); reveal(sndRow.querySelector(".sn.sel"));
  }
  function selectSound(id) {
    sndSel = id; pause();
    const x = P.sounds.find((y) => y.id === id);
    if (x && (t < x.start || t >= x.end)) seek(x.start);
    if (panel !== "sound") { panel = "sound"; requestAnimationFrame(fit); }
    layoutSnds(); renderPanel(); syncBar();
  }
  sndRow.addEventListener("click", (e) => { const el = e.target.closest(".sn"); if (!el || sndRow.dataset.drag) return; e.stopPropagation(); selectSound(el.dataset.id); });
  sndRow.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".sn.sel"); if (!el || e.button > 0) return;
    const x = P.sounds.find((y) => y.id === el.dataset.id);
    e.preventDefault(); pause();
    sdragS = { x, el, side: e.target.dataset.side || "m", px: e.clientX, s0: x.start, e0: x.end, f0: x.from || 0, id: e.pointerId, moved: false };
    sndRow.setPointerCapture(e.pointerId);
  });
  sndRow.addEventListener("pointermove", (e) => {
    const g = sdragS; if (!g || e.pointerId !== g.id) return;
    const d = (e.clientX - g.px) / pps, x = g.x, tot = total(), len = g.e0 - g.s0, dur = P.audios[x.audio]?.dur || 1e9;
    if (!g.moved) { if (Math.abs(e.clientX - g.px) < 4) return; g.moved = true; begin(); }
    if (g.side === "l") { x.start = clamp(g.s0 + d, Math.max(0, g.s0 - g.f0), x.end - 0.1); x.from = g.f0 + (x.start - g.s0); }
    else if (g.side === "r") x.end = clamp(g.e0 + d, x.start + 0.1, Math.min(tot, x.start + dur - (x.from || 0)));
    else { x.start = clamp(g.s0 + d, 0, Math.max(0, tot - len)); x.end = x.start + len; }
    g.el.style.left = x.start * pps + "px"; g.el.style.width = Math.max(8, (x.end - x.start) * pps - 2) + "px";
  });
  const sdragSEnd = (e) => { if (!sdragS || e.pointerId !== sdragS.id) return; const m = sdragS.moved; sdragS = null; if (m) { sndRow.dataset.drag = "1"; setTimeout(() => delete sndRow.dataset.drag, 60); layoutSnds(); renderPanel(); save(); } };
  sndRow.addEventListener("pointerup", sdragSEnd); sndRow.addEventListener("pointercancel", sdragSEnd);

  // ——— титры: свой текст поверх видео (не из речи); своя дорожка, стили — как у субтитров
  let txtSel = null, tdrag = null;
  const tlines = () => textLines(P.texts);
  const freeTxtLayer = (s, e) => { for (let n = 0; ; n++) if (!P.texts.some((x) => (x.layer | 0) === n && x.start < e && x.end > s)) return n; };
  function addText() {
    begin(); pause();
    const tot = total(), start = Math.max(0, Math.min(t, tot - 0.5)), end = Math.min(tot, start + 3);
    const x = { id: uid(), text: "Текст", start, end, style: { ...TEXT_DEFAULT } };
    x.layer = freeTxtLayer(start, end);
    P.texts.push(x); txtSel = x.id; loadFont(TEXT_DEFAULT.font);
    if (panel !== "text") { panel = "text"; requestAnimationFrame(fit); }
    layoutTexts(); draw(); renderPanel(); syncBar(); save();
    requestAnimationFrame(() => { const ta = side.querySelector("textarea.txt"); if (ta) { ta.focus(); ta.select(); } });
  }
  function removeText() { begin(); P.texts = P.texts.filter((x) => x.id !== txtSel); txtSel = null; layoutTexts(); draw(); renderPanel(); syncBar(); save(); }
  function layoutTexts() {
    txtRow.style.width = total() * pps + "px"; txtRow.hidden = !P.texts.length;
    for (const x of P.texts) loadFont(normStyle({ ...TEXT_DEFAULT, ...x.style }).font);
    const n = Math.max(0, ...P.texts.map((x) => (x.layer | 0) + 1));
    txtRow.replaceChildren(...Array.from({ length: n }, (_, k) => h("div.orow", {}, P.texts.filter((x) => (x.layer | 0) === n - 1 - k).map((x) =>
      h("div.tx" + (x.id === txtSel ? ".sel" : ""), { "data-id": x.id, style: { left: x.start * pps + "px", width: Math.max(8, (x.end - x.start) * pps - 2) + "px" } },
        h("span", {}, icon("type", 12), (x.text || "").replace(/\n/g, " ")), h("i.g.l", { "data-side": "l" }), h("i.g.r", { "data-side": "r" }))))));
    autoTl(); reveal(txtRow.querySelector(".tx.sel"));
  }
  function selectText(id) {
    txtSel = id; pause();
    const x = P.texts.find((y) => y.id === id);
    if (x && (t < x.start || t >= x.end)) seek(x.start + Math.min(0.5, (x.end - x.start) / 2));
    if (panel !== "text") { panel = "text"; requestAnimationFrame(fit); }
    layoutTexts(); renderPanel(); syncBar();
  }
  txtRow.addEventListener("click", (e) => { const el = e.target.closest(".tx"); if (!el || txtRow.dataset.drag) return; e.stopPropagation(); selectText(el.dataset.id); });
  txtRow.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".tx.sel"); if (!el || e.button > 0) return;
    const x = P.texts.find((y) => y.id === el.dataset.id);
    e.preventDefault(); pause();
    tdrag = { x, el, side: e.target.dataset.side || "m", px: e.clientX, s0: x.start, e0: x.end, id: e.pointerId, moved: false };
    txtRow.setPointerCapture(e.pointerId);
  });
  txtRow.addEventListener("pointermove", (e) => {
    const g = tdrag; if (!g || e.pointerId !== g.id) return;
    const d = (e.clientX - g.px) / pps, x = g.x, tot = total(), len = g.e0 - g.s0;
    if (!g.moved) { if (Math.abs(e.clientX - g.px) < 4) return; g.moved = true; begin(); }
    if (g.side === "l") x.start = clamp(g.s0 + d, 0, x.end - 0.2);
    else if (g.side === "r") x.end = clamp(g.e0 + d, x.start + 0.2, tot);
    else { x.start = clamp(g.s0 + d, 0, Math.max(0, tot - len)); x.end = x.start + len; }
    g.el.style.left = x.start * pps + "px"; g.el.style.width = Math.max(8, (x.end - x.start) * pps - 2) + "px";
    draw();
  });
  const tdragEnd = (e) => { if (!tdrag || e.pointerId !== tdrag.id) return; const m = tdrag.moved; tdrag = null; if (m) { txtRow.dataset.drag = "1"; setTimeout(() => delete txtRow.dataset.drag, 60); layoutTexts(); draw(); save(); } };
  txtRow.addEventListener("pointerup", tdragEnd); txtRow.addEventListener("pointercancel", tdragEnd);
  // что сейчас настраивается в панели «Текст»: стиль выбранного титра
  const POS_T = ["x", "y", "rot"];
  const txtApi = {
    kind: "text", P, lines: () => [], begin, seek, all: true, word: null, selLines: () => [], scope: () => "all",
    cur: () => normStyle({ ...TEXT_DEFAULT, ...(P.texts.find((x) => x.id === txtSel)?.style || {}) }),
    st: () => (P.texts.find((x) => x.id === txtSel).style ||= {}), gst: () => (P.texts.find((x) => x.id === txtSel).style ||= {}),
    applyStyle(v) { const x = P.texts.find((y) => y.id === txtSel), keep = {}; for (const k of POS_T) if (x.style && k in x.style) keep[k] = x.style[k]; x.style = { ...v, maxChars: 99, wrap: 0.85, ...keep, y: keep.y ?? (x.style?.y ?? TEXT_DEFAULT.y) }; },
    playLine() { const x = P.texts.find((y) => y.id === txtSel); if (!x) return; pause(); seek(Math.max(0, x.start - 0.05)); stopAt = Math.min(x.end, x.start + 2.5); play(); },
    change: (fn) => { begin(); fn(); layoutTexts(); draw(); renderPanel(); save(); },
    live: () => { draw(); save(); },
    rerender: () => { if (panel === "text") renderPanel(); },
    busy: () => {}, making: false, makeSubs: () => {},
  };

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
  // ——— быстрый монтаж: паузы, субтитры, голос, цвет — одним нажатием
  const Q = { cut: true, gap: 0.6, subs: true, style: "Караоке", voice: true, look: "vivid" };
  Object.assign(Q, settings.get("quick") || {});
  let quickBusy = "";
  // убрать паузы: из каждого клипа оставить только куски с речью (паузы длиннее gap вырезаются)
  function cutPauses(gap) {
    const pad = 0.12, outClips = []; let removed = 0;
    for (const c of P.clips) {
      const ws = (P.words[c.media] || []).filter((w) => w.end > c.in && w.start < c.out);
      if (!ws.length || c.curve) { outClips.push(c); continue; }
      const parts = []; let a = Math.max(c.in, ws[0].start - pad), b = Math.min(c.out, ws[0].end + pad);
      for (const w of ws.slice(1)) {
        if (w.start - b > gap) { parts.push([a, b]); a = Math.max(c.in, w.start - pad); }
        b = Math.min(c.out, Math.max(b, w.end + pad));
      }
      parts.push([a, b]);
      const keep = parts.filter(([x, y]) => y - x >= 0.25);
      if (!keep.length) { outClips.push(c); continue; }
      removed += (c.out - c.in) - keep.reduce((s, [x, y]) => s + y - x, 0);
      keep.forEach(([x, y], k) => { const n = { ...c, id: k ? uid() : c.id, in: x, out: y }; if (k < keep.length - 1) delete n.tr; outClips.push(n); });
    }
    P.clips = outClips;
    return removed / (P.clips[0]?.speed || 1);
  }
  async function quickEdit() {
    if (quickBusy) return;
    settings.set("quick", Q);
    try {
      pause();
      if (Q.cut || Q.subs) {
        quickBusy = "Распознаю речь…"; renderPanel();
        for (const k of new Set(P.clips.map((c) => c.media))) if (!(P.words[k] || []).length) { const w = await ensureWords(k, P.media[k].name); P.words[k] = JSON.parse(JSON.stringify(w)); }
      }
      begin();
      let removed = 0;
      if (Q.cut) removed = cutPauses(Q.gap);
      if (Q.subs && P.clips.some((c) => (P.words[c.media] || []).length)) { const pr = PRESETS.find((x) => x[0] === Q.style) || PRESETS[1]; P.subs = { on: true, style: { ...(P.subs?.style || {}), ...pr[1] } }; }
      if (Q.voice) P.voice = { ...VOICE_ON };
      if (Q.look && Q.look !== "none") { const L = LOOKS.find((x) => x[0] === Q.look); if (L) { P.look = { id: L[0], k: 1 }; P.grade = scaleLook(L[2], 1); } }
      quickBusy = "";
      layout(); seek(0); renderPanel(); save();
      toast(`Готово${Q.cut ? `: убрано ${removed.toFixed(1).replace(".", ",")} с пауз` : ""}. Отменить — стрелка вверху`, 5000);
    } catch (e) { quickBusy = ""; renderPanel(); toast(e.message, 6000); }
  }
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
      const time = srcAt(clip, (x + tw / 2) / k / pps);
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
    // значки переходов на стыках клипов
    let at = 0;
    const si = P.clips.findIndex((c) => c.id === sel);   // у выделенного клипа края тянутся — значки рядом прячем
    P.clips.forEach((c, i) => { at += len(c); if (i < P.clips.length - 1 && i !== si && i !== si - 1) track.append(h("button.trb" + (c.tr && c.tr.kind !== "none" ? ".on" : "") + (trSel === c.id ? ".sel" : ""), { "data-id": c.id, "aria-label": "Переход", style: { left: at * pps + "px" } }, c.tr && c.tr.kind !== "none" ? "◆" : "◇")); });
    relines(); layoutClouds(); layoutOvs(); layoutSnds(); layoutTexts(); layoutBusy(); syncBar();
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
  function zoom(k) { pps = clamp(pps * k, 3, 240); layout(); tlSettle(); }
  // при воспроизведении таймлайн крутит сама программа; паузу ставит только палец (или колесо), а не запоздавшее
  // событие прокрутки от iPad — раньше из-за него воспроизведение само останавливалось и дёргалось
  let userAt = 0;
  for (const ev of ["touchstart", "touchmove", "pointerdown", "wheel"]) scroll.addEventListener(ev, () => { userAt = performance.now(); }, { passive: true });
  scroll.addEventListener("scroll", () => {
    if (drag) return;
    if (playing && (flow || performance.now() - userAt > 1200)) { if (flow && performance.now() - userAt < 300) pause(); return; }
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
      pps = clamp(pinch.pps * d / pinch.d, 3, 240); layout(); tlSettle();
    } else if (drag) e.preventDefault();
  }, { passive: false });
  scroll.addEventListener("touchend", () => { pinch = null; }, { passive: true });
  scroll.addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });

  // касания клипов: выбор, края (обрезка), долгое нажатие (перестановка)
  let drag = null, press = null;
  track.addEventListener("click", (e) => {
    const tb = e.target.closest(".trb");
    if (tb) { e.stopPropagation(); trSel = tb.dataset.id; pause(); const i = P.clips.findIndex((c) => c.id === trSel); seek(Math.max(0, startOf(i + 1) - 0.6)); panel = "transition"; renderPanel(); syncBar(); layout(); requestAnimationFrame(fit); return; }
    if (drag || track.dataset.justDragged) return;
    const el = e.target.closest(".clip");
    if (!el) return;
    if (sel === el.dataset.id) return unselect();
    selectClip(el.dataset.id);
  });
  scroll.addEventListener("click", (e) => { if (e.target === scroll || e.target === inner || e.target === track || e.target === ruler || e.target === subRow || e.target === cloudRow || e.target === ovRow || e.target === sndRow || e.target === txtRow) { if (sel) unselect(); } });
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
      if (drag.side === "l") c.in = clamp(drag.in0 + dx / pps * rateAt(c, 0), 0, c.out - MIN_LEN);
      else c.out = clamp(drag.out0 + dx / pps * rateAt(c, len(c)), c.in + MIN_LEN, m.dur);
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

  // ——— выбор клипа: внизу появляются его действия, открытая панель клипа сразу показывает его
  function selectClip(id) {
    sel = id; trSel = null; pause();
    const i = P.clips.findIndex((c) => c.id === id), a = startOf(i), b = a + len(P.clips[i]);
    if (t < a || t >= b - 0.02) seek(a + Math.min(0.05, (b - a) / 2));   // линию — в начало клипа, чтобы видеть, что меняем
    if (panel && !CLIP_PANELS.has(panel) && panel !== "color") panel = null;
    if (panel === "transition") panel = null;
    renderPanel(); layout(); syncBar(); requestAnimationFrame(fit);
  }
  function unselect() {
    sel = null; trSel = null;
    if (CLIP_PANELS.has(panel)) panel = null;
    renderPanel(); layout(); syncBar(); requestAnimationFrame(fit);
  }
  function pickClip() { const c = locate(t)?.clip; if (c) selectClip(c.id); }
  function clipTransition() {
    let i = P.clips.findIndex((c) => c.id === sel);
    if (P.clips.length < 2) return toast("Переход нужен между двумя клипами — добавьте ещё видео");
    if (i === P.clips.length - 1) i--;   // у последнего клипа — стык слева
    trSel = P.clips[i].id; pause(); seek(Math.max(0, startOf(i + 1) - 0.6));
    panel = panel === "transition" ? null : "transition"; renderPanel(); syncBar(); layout(); requestAnimationFrame(fit);
  }
  function duplicate() {
    const i = P.clips.findIndex((c) => c.id === sel); if (i < 0) return;
    begin(); pause();
    const c = P.clips[i], b = JSON.parse(JSON.stringify(c)); b.id = uid(); delete b.tr;
    P.clips.splice(i + 1, 0, b); sel = b.id; layout(); seek(startOf(i + 1) + 0.05); save(); syncBar();
    toast("Копия — сразу после клипа");
  }

  // ——— действия
  function split() {
    const loc = locate(t);
    if (!loc || loc.local < MIN_LEN || len(loc.clip) - loc.local < MIN_LEN) return toast("Поставьте линию туда, где нужно разрезать");
    begin(); pause();
    const c = loc.clip, cut = srcAt(c, loc.local);
    const b = { ...c, id: uid(), in: cut, frame: c.frame && { ...c.frame }, ...(c.mask ? { mask: { ...c.mask } } : {}) };
    if (c.curve) { const [ca, cb] = splitCurve(c.curve, (cut - c.in) / (c.out - c.in)); c.curve = ca; b.curve = cb; }   // кривая делится вместе с клипом
    c.out = cut;
    P.clips.splice(loc.i + 1, 0, b);
    sel = b.id; layout(); seek(t); save();
  }
  function remove() {
    if (panel === "overlay" && ovSel) return removeOverlay();
    if (panel === "sound" && sndSel) return removeSound();
    if (panel === "text" && txtSel) return removeText();
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
    if (P.clips.length === recs.length) { pps = clamp((scroll.clientWidth * 0.8) / Math.max(1, total()), 3, 240); panel = "quick"; renderPanel(); requestAnimationFrame(fit); }
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
  // «Мои» в каждой вкладке: что сохранить и как применить (служебные поля — время, файл, слой — не трогаем)
  const strip = (o, keys) => { if (!o) return null; const r = { ...o }; for (const k of keys) delete r[k]; return r; };
  const OWN = ["id", "start", "end", "layer", "from", "media", "audio", "image", "img", "key", "kind", "src", "name", "text"];
  function myFor(p) {
    const c = target(), apply = (fn) => (d) => { begin(); fn(d); layout(); renderPanel(); draw(); save(); };
    const find = (list, id) => list.find((x) => x.id === id);
    switch (p) {
      case "color": return ["color", () => (Object.keys(P.grade || {}).length ? { grade: P.grade, look: P.look || null } : null), apply((d) => { P.grade = d.grade || {}; if (d.look) P.look = d.look; else delete P.look; })];
      case "frame": return c && ["frame", () => c.frame || null, apply((d) => { c.frame = d; })];
      case "mask": return c && ["mask", () => (c.mask && c.mask.shape !== "none" ? c.mask : null), apply((d) => { c.mask = d; })];
      case "speed": return c && ["speed", () => (c.curve || c.speed ? { speed: c.speed || null, curve: c.curve || null } : null), apply((d) => { delete c.speed; delete c.curve; if (d.curve) c.curve = d.curve; else if (d.speed) c.speed = d.speed; })];
      case "transition": { const t0 = find(P.clips, trSel); return t0 && ["transition", () => t0.tr || null, apply((d) => { t0.tr = d; })]; }
      case "subs": return P.subs && ["subs", () => P.subs.style, apply((d) => { P.subs.style = d; })];
      case "text": { const x = find(P.texts, txtSel); return x && ["text", () => x.style, apply((d) => { x.style = d; })]; }
      case "overlay": { const o = find(P.overlays, ovSel); return o && ["overlay", () => strip(o, OWN), apply((d) => { Object.assign(o, d); })]; }
      case "cloud": { const o = find(P.clouds, cloudSel); return o && ["cloud", () => strip(o, OWN), apply((d) => { Object.assign(o, d); })]; }
      case "sound": { const o = find(P.sounds, sndSel); return o ? ["sound", () => strip(o, OWN), apply((d) => { Object.assign(o, d); })]
        : ["voice", () => (Object.keys(P.voice || {}).length ? P.voice : null), apply((d) => { P.voice = d; })]; }
    }
    return null;
  }
  function renderPanel() {
    renderPanel0();
    const m = panel && myFor(panel), hd = side.querySelector(".panel-head");
    if (m && hd) hd.after(mine(m[0], m[1], m[2], renderPanel));
  }
  function renderPanel0() {
    side.hidden = !panel;
    ed.classList.toggle("with-panel", !!panel);
    ed.dataset.panel = panel || "";   // выделение показываем только у того, что сейчас настраивается
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
      const g = P.grade, tabs = ["Пресеты", ...GROUPS.map((x) => x[0]), "Оттенки"];
      let body;
      if (colorTab === 0) {
        const lk = P.look && LOOKS.find((x) => x[0] === P.look.id);
        const apply = (id, k) => { const L = LOOKS.find((x) => x[0] === id); P.look = { id, k }; P.grade = scaleLook(L[2], k); draw(); };
        body = [h("div.looks", {}, favSort("look", LOOKS).map(([id, name]) => h("button" + (P.look?.id === id || (!P.look && id === "natural") ? ".on" : ""), { "data-look": id, onclick: () => { begin(); apply(id, P.look?.k ?? 1); renderPanel(); save(); } },
            h("img", { alt: "" }), h("span", {}, name), id !== "natural" && favStar("look", id, renderPanel)))),
          lk && lk[0] !== "natural" ? slider("Сила пресета", () => P.look.k, (v) => apply(P.look.id, v), { min: 0, max: 1.5, def: 1, show: (v) => Math.round(v * 100) + " %" }) : null,
          h("p.hint", {}, "Пресет ставит ползунки во вкладках «Свет», «Цвет», «Детали» — их можно подправить после.")].filter(Boolean);
        requestAnimationFrame(lookThumbs);
      } else if (colorTab <= GROUPS.length) body = GROUPS[colorTab - 1][1].map(([k, label, min]) => slider(label, () => g[k] ?? GRADE_DEFAULT[k], (v) => g[k] = v, { min: min ?? -1 }));
      else {
        const b = HSL_BANDS[band], arr = () => ((g.hsl ||= {})[b] ||= [0, 0, 0]);
        body = [h("div.bands", {}, BAND_COLORS.map((col, i) => h("button" + (i === band ? ".on" : ""), { style: { background: col }, "aria-label": "Цвет " + (i + 1), onclick: () => { band = i; renderPanel(); } }))),
          ...["Тон", "Насыщенность", "Светлота"].map((label, i) => slider(label, () => (g.hsl?.[b] || [0, 0, 0])[i], (v) => arr()[i] = v))];
      }
      side.replaceChildren(head("Цвет", () => { begin(); P.grade = {}; delete P.look; renderPanel(); draw(); save(); }),
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
    } else if (panel === "quick") {
      const tog = (k, label, sub) => h("button.check" + (Q[k] ? ".on" : ""), { onclick: () => { Q[k] = !Q[k]; settings.set("quick", Q); renderPanel(); } }, h("i", {}, Q[k] ? icon("check", 14) : null), h("span", {}, label, sub ? h("small.muted", {}, " " + sub) : null));
      side.replaceChildren(head("Быстрый монтаж"),
        h("p.hint", {}, "Отметьте, что сделать, и нажмите одну кнопку. Всё можно поправить потом или отменить стрелкой вверху."),
        tog("cut", "Убрать паузы", "и тишину в начале и конце"),
        Q.cut ? slider("Паузы длиннее", () => Q.gap, (v) => { Q.gap = v; settings.set("quick", Q); }, { min: 0.3, max: 2, step: 0.05, def: 0.6, show: (v) => v.toFixed(1).replace(".", ",") + " с" }) : null,
        tog("subs", "Субтитры"),
        Q.subs ? h("div.seg.scroll", {}, favSort("style", PRESETS).slice(0, 8).map(([n]) => h("button" + (Q.style === n ? ".on" : ""), { onclick: () => { Q.style = n; settings.set("quick", Q); renderPanel(); } }, n))) : null,
        tog("voice", "Улучшить голос"),
        h("div.sl-top", {}, "Цвет"),
        h("div.seg.scroll", {}, [["none", "Не менять"], ...favSort("look", LOOKS.filter((x) => x[0] !== "natural"))].map(([id, n]) => h("button" + (Q.look === id ? ".on" : ""), { onclick: () => { Q.look = id; settings.set("quick", Q); renderPanel(); } }, n))),
        h("button.btn.primary.wide.big", { onclick: quickEdit, disabled: !!quickBusy }, quickBusy || "Сделать монтаж"),
        h("p.hint", {}, "Паузы и субтитры берутся из распознанной речи. Если видео ещё не готовилось, распознавание займёт до 4 минут."));
    } else if (panel === "transition") {
      const i = P.clips.findIndex((c) => c.id === trSel), c = P.clips[i];
      if (!c || i >= P.clips.length - 1) return side.replaceChildren(head("Переход"), h("p.hint", {}, "Нажмите на значок ◇ между клипами на дорожке."));
      const tr = c.tr || { kind: "none", dur: 0.6 };
      const ch = (fn) => { begin(); fn(); layout(); renderPanel(); save(); preview(); };
      const preview = () => { const s0 = startOf(i + 1); pause(); seek(Math.max(0, s0 - (c.tr?.dur || 0.6) / 2 - 0.4)); stopAt = Math.min(total(), s0 + (c.tr?.dur || 0.6) / 2 + 0.4); play(); };
      side.replaceChildren(head("Переход"),
        h("p.hint", {}, `Между клипами ${i + 1} и ${i + 2}. Переход закрывает кадр и открывает следующий; текст и субтитры остаются поверх.`),
        h("div.tiles", {}, favSort("transition", TRANSITIONS).map(([k, n]) => h("button" + (tr.kind === k ? ".on" : ""), { onclick: () => ch(() => { if (k === "none") delete c.tr; else c.tr = { ...tr, kind: k }; }) }, n, k !== "none" && favStar("transition", k, renderPanel)))),
        tr.kind !== "none" ? slider("Длительность", () => c.tr.dur || 0.6, (v) => { c.tr.dur = v; draw(); }, { min: 0.2, max: 2, def: 0.6, show: (v) => v.toFixed(1).replace(".", ",") + " с" }) : null,
        tr.kind !== "none" ? h("div.row-btns", {}, h("button.btn.sm", { onclick: preview }, "Показать"),
          h("button.btn.sm", { onclick: () => ch(() => { P.clips.forEach((x, k) => { if (k < P.clips.length - 1) x.tr = { ...c.tr }; }); }) }, "Применить ко всем стыкам")) : null);
      side.querySelector("input[type=range]")?.addEventListener("change", () => { save(); preview(); });
    } else if (panel === "speed") {
      const c = target(); shown = c?.id;
      if (!c) return side.replaceChildren(head("Скорость"), h("p.muted", {}, "Добавьте видео."));
      const ci = P.clips.indexOf(c), at = startOf(ci);
      // после правки линия остаётся там же в исходнике (тот же кадр), а не прыгает в начало клипа
      const keep = () => { const loc = locate(t); return loc && loc.clip === c ? srcAt(c, loc.local) : null; };
      const done = (src = keep()) => { layout(); seek(src == null ? at + 0.01 : startOf(ci) + Math.min(outAt(c, src), len(c) - 0.02)); renderPanel(); save(); };
      const set = (v) => { begin(); delete c.curve; if (v === 1) delete c.speed; else c.speed = v; done(); };
      const cur = sp(c), srcLen = c.out - c.in, mode = c.curve ? 1 : speedTab;
      const tabs = h("div.seg", {}, ["Обычная", "Кривая"].map((n, i) => h("button" + (mode === i ? ".on" : ""), { onclick: () => { speedTab = i; if (i === 0 && c.curve) { begin(); delete c.curve; done(); } else renderPanel(); } }, n)));
      const info = h("p.speed-info", {});
      // секунды — сразу, пока тянете: длина клипа на экране, длина ролика, ширина клипа на таймлайне
      const live = () => {
        info.replaceChildren(h("span", {}, "Было ", h("b", {}, fmtTime(srcLen, true))), h("span", {}, " → стало ", h("b", {}, fmtTime(len(c), true))));
        tAll.textContent = fmtTime(total());
        const el = track.querySelector(`.clip[data-id="${c.id}"]`); if (el) { el.style.width = len(c) * pps + "px"; const s = el.querySelector(".clip-len"); if (s) s.textContent = fmtTime(len(c), true); }
      };
      live();
      if (mode === 0) {
        side.replaceChildren(head("Скорость", (cur !== 1 || c.curve) && (() => set(1))), tabs, info,
          h("div.tiles", {}, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((v) => h("button" + (!c.curve && Math.abs(cur - v) < 1e-6 ? ".on" : ""), { onclick: () => set(v) }, String(v).replace(".", ",") + "×"))),
          slider("Точно", () => cur, (v) => { c.speed = Math.round(v * 100) / 100; live(); }, { min: 0.25, max: 4, step: 0.05, def: 1, show: (v) => v.toFixed(2).replace(".", ",") + "×" }),
          h("p.hint", {}, "Для выбранного клипа. Звук ускоряется и замедляется без изменения тона."));
        side.querySelector("input[type=range]").addEventListener("change", () => done());
      } else {
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const mine = settings.get("myCurves") || [];
        const preset = CURVES.find(([, , pts]) => same(pts, c.curve)) || mine.find(([, , pts]) => same(pts, c.curve));
        const pick = (pts) => { begin(); delete c.speed; c.curve = pts.map((p) => [...p]); curveSel = -1; done(); };
        const tile = (k, n, pts, extra) => h("button" + ((k === "custom" ? c.curve && !preset : preset && preset[0] === k) ? ".on" : ""), { "data-curve": k, onclick: () => pick(pts) }, curveIcon(pts), h("span", {}, n), extra);
        const graph = c.curve ? curveEditor(c, done, live) : null;
        const saveMine = async () => {
          const name = await askText("Название шаблона", "Мой " + (mine.length + 1));
          if (!name) return;
          settings.set("myCurves", [...mine, ["my" + uid(), name.slice(0, 24), c.curve.map((p) => [...p])]]); renderPanel(); toast("Шаблон сохранён");
        };
        const dropMine = (k) => (e) => { e.stopPropagation(); settings.set("myCurves", mine.filter((x) => x[0] !== k)); renderPanel(); };
        side.replaceChildren(head("Скорость", c.curve && (() => set(1))), tabs,
          ...(c.curve ? [info, graph] : [h("p.hint", {}, "Нажмите «Своя» или шаблон — появится кривая с точками.")]),
          h("div.tiles.curves", {}, tile("custom", "Своя", c.curve && !preset ? c.curve : [[0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]]),
            ...mine.map(([k, n, pts]) => tile(k, n, pts, h("span.star", { onclick: dropMine(k), title: "Убрать шаблон" }, "×"))),
            ...favSort("curve", CURVES).map(([k, n, pts]) => tile(k, n, pts, favStar("curve", k, renderPanel)))),
          c.curve ? h("div.row-btns", {}, h("button.btn.sm", { onclick: saveMine }, "Сохранить кривую как шаблон")) : null);
      }
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
    } else if (panel === "text") {
      const x = P.texts.find((y) => y.id === txtSel);
      const add = h("button.btn.primary.wide", { onclick: addText }, icon("plus", 18), "Добавить текст здесь");
      if (!x) return side.replaceChildren(head("Текст"),
        h("p.hint", {}, "Свой текст поверх видео: заголовок, подпись, призыв. Не зависит от речи. Стили, шрифты, цвета и анимации — те же, что у субтитров. Живёт на своей дорожке."),
        add, P.texts.length ? h("p.hint", {}, "Чтобы изменить текст, нажмите на него на дорожке внизу или прямо на видео.") : null);
      const ta = h("textarea.field.area.txt", { value: x.text, rows: 2, "aria-label": "Текст", autocapitalize: "sentences",
        onfocus: () => { begin(); }, oninput: () => { x.text = ta.value; draw(); layoutTexts(); save(); } });
      txtApi.slider = slider; txtApi.head = head;
      txtApi.top = [ta, h("p.hint", {}, "Enter — новая строка. Двигайте текст пальцем прямо на видео, двумя пальцами — размер.")];
      txtApi.bottom = [add, h("button.btn.wide.danger", { onclick: removeText }, "Удалить текст")];
      side.replaceChildren(...subsPanel(txtApi).flat(9).filter(Boolean));
    } else if (panel === "overlay") {
      const o = P.overlays.find((x) => x.id === ovSel);
      const add = h("button.btn.primary.wide", { onclick: () => { pause(); openOverlayPicker({ onImage: addOverlayImage, onVideo: addOverlayVideo }); } }, icon("plus", 18), "Добавить наложение здесь");
      if (!o) return side.replaceChildren(head("Наложение"),
        h("p.hint", {}, "Фото, стикер или видео поверх основного видео — например, картинка-в-картинке, логотип, скриншот. Каждое наложение живёт на своей дорожке: его можно двигать по времени, тянуть за края, поднимать выше других."),
        add, P.overlays.length ? h("p.hint", {}, "Чтобы изменить наложение, нажмите на него на дорожке внизу или прямо на видео.") : null);
      const ch = (fn) => { begin(); fn(); layoutOvs(); syncOv(); draw(); renderPanel(); save(); };
      const osl = (label, key, min, max, show, step) => slider(label, () => o[key] ?? OV_DEFAULT[key], (v) => { o[key] = v; }, { min, max, step, def: OV_DEFAULT[key], show });
      const pct = (v) => Math.round(v * 100), sec = (v) => v.toFixed(2).replace(".", ",") + " с";
      const tiles = (list, on, pick, fav) => h("div.tiles", {}, (fav ? favSort(fav, list) : list).map(([k, n]) => h("button" + (on === k ? ".on" : ""), { onclick: () => pick(k) }, n, fav && k !== "none" && favStar(fav, k, renderPanel))));
      const sz = ovSize(o) || { w: 1, h: 1 }, fr = out(), cover = Math.max(1, (fr.h / fr.w) * (sz.w / sz.h));
      const maxL = Math.max(0, ...P.overlays.map((x) => x.layer | 0));
      const m = o.mask && o.mask.shape !== "none" ? o.mask : null;
      let body;
      if (ovTab === 0) body = [
        h("p.hint", {}, "Двигайте пальцем прямо на видео, двумя пальцами — размер и поворот."),
        h("div.seg", {}, h("button", { onclick: () => ch(() => Object.assign(o, { x: 0.5, y: 0.5, scale: Math.round(cover * 100) / 100, rot: 0 })) }, "На весь кадр"),
          h("button", { onclick: () => ch(() => Object.assign(o, { x: 0.5, y: 0.5 })) }, "По центру")),
        osl("Размер", "scale", 0.05, 2.5, pct), osl("Прозрачность", "opacity", 0, 1, pct), osl("Поворот", "rot", -180, 180, (v) => Math.round(v) + "°", 1),
        osl("Скругление углов", "radius", 0, 1, pct),
        h("button.check" + (o.flip ? ".on" : ""), { onclick: () => ch(() => { o.flip = !o.flip; }) }, h("i", {}, o.flip ? icon("check", 14) : null), "Отразить зеркально"),
        h("div.layers", {}, h("small.muted", {}, "Слой"),
          h("button", { disabled: !(o.layer | 0), onclick: () => ch(() => { o.layer = Math.max(0, (o.layer | 0) - 1); }) }, "Ниже"),
          h("button", { onclick: () => ch(() => { o.layer = (o.layer | 0) + 1; }) }, "Выше"),
          h("small.muted", {}, `${(o.layer | 0) + 1} из ${maxL + 1}`))];
      else if (ovTab === 1) body = [
        h("div.sl-top", {}, "Появление"), tiles(OV_IN, o.in ?? OV_DEFAULT.in, (k) => ch(() => { o.in = k; }), "ov-in"), ...((o.in ?? OV_DEFAULT.in) !== "none" ? [osl("Длительность появления", "inDur", 0.05, 2, sec), ...easePicker(o.inEase, (k) => ch(() => { o.inEase = k; }))] : []),
        h("div.sl-top", {}, "Исчезание"), tiles(OV_OUT, o.out ?? OV_DEFAULT.out, (k) => ch(() => { o.out = k; }), "ov-out"), ...((o.out ?? OV_DEFAULT.out) !== "none" ? [osl("Длительность исчезания", "outDur", 0.05, 2, sec), ...easePicker(o.outEase, (k) => ch(() => { o.outEase = k; }))] : []),
        h("div.sl-top", {}, "Пока на экране"), tiles(OV_LOOP, o.loop ?? OV_DEFAULT.loop, (k) => ch(() => { o.loop = k; }), "ov-loop")];
      else body = [
        h("p.hint", {}, "Оставляет видимой только часть наложения, края можно растушевать."),
        tiles(MASK_SHAPES, m ? m.shape : "none", (k) => ch(() => { if (k === "none") delete o.mask; else o.mask = { ...MASK_DEFAULT, w: 0.9, h: 0.9, ...(o.mask || {}), shape: k }; })),
        ...(m ? [slider("Ширина", () => o.mask.w, (v) => { o.mask.w = v; }, { min: 0.05, max: 1.5, def: 0.9 }), slider("Высота", () => o.mask.h, (v) => { o.mask.h = v; }, { min: 0.03, max: 1.5, def: 0.9 }),
          slider("Растушёвка края", () => o.mask.feather, (v) => { o.mask.feather = v; }, { min: 0, max: 0.5, def: MASK_DEFAULT.feather }),
          slider("Поворот маски", () => o.mask.rot, (v) => { o.mask.rot = v; }, { min: -180, max: 180, step: 1, def: 0, show: (v) => Math.round(v) + "°" }),
          h("button.check" + (m.invert ? ".on" : ""), { onclick: () => ch(() => { o.mask.invert = !m.invert; }) }, h("i", {}, m.invert ? icon("check", 14) : null), "Наоборот: убрать то, что внутри")] : [])];
      side.replaceChildren(head("Наложение"),
        h("div.ov-name", {}, icon(o.kind === "video" ? "film" : "photo", 16), h("span", {}, ovName(o))),
        h("div.seg.scroll.tabs", {}, ["Вид", "Анимация", "Маска"].map((n, i) => h("button" + (i === ovTab ? ".on" : ""), { onclick: () => { ovTab = i; renderPanel(); } }, n))),
        h("div.sliders", {}, body.filter(Boolean)),
        add, h("button.btn.wide.danger", { onclick: removeOverlay }, "Удалить наложение"));
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
      const x = P.sounds.find((y) => y.id === sndSel);
      const add = h("button.btn.primary.wide", { onclick: () => { pause(); openSoundPicker({ onSound: addSound }); } }, icon("plus", 18), "Добавить музыку или звук здесь");
      const ch = (fn) => { begin(); fn(); layoutSnds(); syncSnd(); renderPanel(); save(); };
      const xsl = (label, key, min, max, def, show) => slider(label, () => x[key] ?? def, (v) => { x[key] = v; layoutSnds(); syncSnd(); }, { min, max, def, show });
      const pct = (v) => Math.round(v * 100) + " %", sec = (v) => v.toFixed(1).replace(".", ",") + " с";
      side.replaceChildren(head("Звук"),
        h("div.sl-top.strong", {}, "Голос и звук видео"),
        slider("Громкость видео", () => P.volume, (v) => { P.volume = v; setVolume(); }, { min: 0, max: 2, def: 1, show: pct }),
        ...voiceBox(),
        h("div.sl-top.strong", {}, "Музыка и звуки"),
        add,
        ...(x ? [h("div.ov-name", {}, icon("sound", 16), h("span", {}, sndName(x))),
          xsl("Громкость", "volume", 0, 2, 1, pct),
          xsl("Плавное начало", "fadeIn", 0, Math.min(8, x.end - x.start), 0, sec), xsl("Плавный конец", "fadeOut", 0, Math.min(8, x.end - x.start), 0, sec),
          h("button.check" + (x.duck ? ".on" : ""), { onclick: () => ch(() => { x.duck = !x.duck; }) }, h("i", {}, x.duck ? icon("check", 14) : null), "Приглушать, когда говорят"),
          h("p.hint", {}, "Тяните звук на дорожке внизу, за жёлтые края — обрезайте. Громче 100 % слышно только в готовом видео. Приглушение под голос в превью слышно, если созданы субтитры; в готовом видео — всегда."),
          h("button.btn.wide.danger", { onclick: removeSound }, "Удалить звук")]
          : [P.sounds.length ? h("p.hint", {}, "Чтобы изменить звук, нажмите на него на дорожке внизу.") : h("p.hint", {}, "Фоновая музыка или звуковой эффект из «Для монтажа ПАК» или с устройства. Музыка сама встанет тише и будет приглушаться под голос.")]));
    }
  }
  // превью пресетов цвета на текущем кадре
  let lookR = null; const lookCv = document.createElement("canvas");
  function lookThumbs() {
    const loc = locate(t), rec = loc && vids.get(loc.clip.media);
    if (!rec || !rec.ok) return;
    const o = out(); lookCv.width = 96; lookCv.height = Math.round(96 * o.h / o.w);
    lookR ||= createRenderer(lookCv);
    if (!lookR) return;
    for (const b of side.querySelectorAll(".looks button")) {
      const L = LOOKS.find((x) => x[0] === b.dataset.look);
      lookR.draw(rec.v, rec.w, rec.h, o, loc.clip.frame, scaleLook(L[2], 1));
      try { b.querySelector("img").src = lookCv.toDataURL("image/jpeg", 0.75); } catch {}
    }
  }
  // ——— переходы: стыки клипов (переход хранится у клипа слева: clip.tr)
  let trSel = null;
  function trList() { const out = []; let at = 0; P.clips.forEach((c, i) => { at += len(c); if (c.tr && c.tr.kind !== "none" && i < P.clips.length - 1) out.push({ at, kind: c.tr.kind, dur: c.tr.dur || 0.6 }); }); return out; }
  // ——— кривая скорости: маленький график шаблона и редактор точек
  let speedTab = 0;
  const ly = (v) => Math.log(v / VMIN) / Math.log(VMAX / VMIN);   // скорость → высота (логарифмическая шкала)
  const vy = (y) => VMIN * Math.pow(VMAX / VMIN, y);
  function curveIcon(pts) {
    const d = Array.from({ length: 33 }, (_, i) => { const u = i / 32; return `${(u * 60).toFixed(1)},${(22 - ly(speedAt(pts, u)) * 20).toFixed(1)}`; }).join(" ");
    return h("span.cv", { html: `<svg viewBox="0 0 60 24" width="60" height="24"><line x1="0" x2="60" y1="${22 - ly(1) * 20}" y2="${22 - ly(1) * 20}" stroke="rgba(255,255,255,.25)" stroke-dasharray="2 2"/><polyline points="${d}" fill="none" stroke="currentColor" stroke-width="2"/></svg>` });
  }
  // редактор кривой как в CapCut: белая линия — где сейчас кадр; тяните по пустому месту — листать видео;
  // точку можно взять и двигать (видео показывает кадр под точкой), добавить или убрать кнопками
  let curveSel = -1;
  function curveEditor(c, done, live) {
    const W = 300, H = 160, T = 18, cv = h("canvas.curve", { width: W * 2, height: H * 2 }), g = cv.getContext("2d");
    const S = Math.max(1e-6, c.out - c.in), ci = () => P.clips.indexOf(c);
    const Y = (v) => H - 8 - ly(v) * (H - 8 - T);
    const nowU = () => { const loc = locate(t); return loc && loc.clip === c ? clamp((srcAt(c, loc.local) - c.in) / S, 0, 1) : null; };
    const goU = (u) => { const i = ci(); if (i < 0) return; seek(startOf(i) + clamp(outAt(c, c.in + u * S), 0, len(c) - 0.02)); };
    const addB = h("button.btn.sm", { onclick: () => {
      const u = nowU() ?? 0.5, near = c.curve.findIndex(([pu]) => Math.abs(pu - u) < 0.03);
      if (near >= 0) { curveSel = near; return paint(); }
      begin(); const v = Math.round(speedAt(c.curve, u) * 100) / 100, i = c.curve.findIndex(([pu]) => pu > u);
      c.curve.splice(i, 0, [Math.round(u * 1000) / 1000, v]); curveSel = i; done();
    } }, icon("plus", 16), "Точка");
    const delB = h("button.btn.sm", { onclick: () => {
      if (curveSel <= 0 || curveSel >= c.curve.length - 1) return toast("Выберите точку внутри кривой — крайние не убираются");
      begin(); c.curve.splice(curveSel, 1); curveSel = -1; done();
    } }, icon("trash", 16), "Убрать точку");
    const paint = () => {
      if (!c.curve || !cv.isConnected) return;
      g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H);
      g.strokeStyle = "rgba(255,255,255,.12)"; g.fillStyle = "rgba(255,255,255,.45)"; g.font = "10px -apple-system, sans-serif"; g.lineWidth = 1;
      for (const v of [0.25, 0.5, 1, 2, 4, 8]) { const y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillText(String(v).replace(".", ",") + "×", 3, y - 2); }
      g.strokeStyle = "#ffd60a"; g.lineWidth = 2.5; g.beginPath();
      for (let i = 0; i <= 120; i++) { const u = i / 120, y = Y(speedAt(c.curve, u)); i ? g.lineTo(u * W, y) : g.moveTo(0, y); }
      g.stroke();
      const u0 = nowU();
      if (u0 != null) { g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(u0 * W, T - 4); g.lineTo(u0 * W, H); g.stroke(); }
      c.curve.forEach(([u, v], i) => {
        const x = clamp(u * W, 7, W - 7), y = Y(v), on = i === curveSel;
        g.fillStyle = on ? "#ffd60a" : "#fff"; g.beginPath(); g.arc(x, y, on ? 8 : 6.5, 0, 7); g.fill();
        if (on) {   // над выбранной точкой — её скорость и секунда ролика
          const sec = outAt(c, c.in + u * S), lbl = String(v).replace(".", ",") + "×  " + fmtTime(sec, true);
          g.font = "600 11px -apple-system, sans-serif"; const tw = g.measureText(lbl).width + 10, bx = clamp(x - tw / 2, 0, W - tw);
          g.fillStyle = "rgba(0,0,0,.75)"; g.fillRect(bx, 0, tw, 15); g.fillStyle = "#ffd60a"; g.fillText(lbl, bx + 5, 11);
        }
      });
      const inner = curveSel > 0 && curveSel < c.curve.length - 1;
      delB.disabled = !inner;
    };
    let dragI = -1, moved = false;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), (e.clientY - r.top) / r.height * H]; };
    cv.addEventListener("pointerdown", (e) => {
      const [u, py] = pt(e); let best = -1, bd = 22;   // 22 точки экрана — палец попадает
      c.curve.forEach(([pu, pv], i) => { const d = Math.hypot((pu - u) * W, Y(pv) - py); if (d < bd) { bd = d; best = i; } });
      e.preventDefault(); pause(); cv.setPointerCapture(e.pointerId); moved = false;
      if (best >= 0) { dragI = best; curveSel = best; goU(c.curve[best][0]); }
      else { dragI = -2; goU(u); }
      paint();
    });
    cv.addEventListener("pointermove", (e) => {
      if (dragI === -1) return;
      const [u, py] = pt(e);
      if (dragI === -2) { goU(u); return paint(); }
      if (!moved) { begin(); moved = true; }
      const p = c.curve[dragI], n = c.curve.length;
      let v = Math.round(vy(clamp((H - 8 - py) / (H - 8 - T), 0, 1)) * 100) / 100;
      if (Math.abs(v - 1) < 0.06) v = 1;
      p[1] = v;
      if (dragI > 0 && dragI < n - 1) p[0] = Math.round(clamp(u, c.curve[dragI - 1][0] + 0.03, c.curve[dragI + 1][0] - 0.03) * 1000) / 1000;
      live(); goU(p[0]); paint();
    });
    const upC = () => { const was = dragI; dragI = -1; if (was >= 0 && moved) done(); };
    cv.addEventListener("pointerup", upC); cv.addEventListener("pointercancel", upC);
    curveHook = paint;   // при воспроизведении и прокрутке белая линия идёт вместе с видео
    paint();
    return h("div.curve-box", {}, cv, h("div.row-btns", {}, addB, delB),
      h("p.hint", {}, "Точку вверх — быстрее, вниз — медленнее. «Точка» — новая там, где белая линия."));
  }
  let curveHook = null;
  // обработка голоса: та же цепочка, что в «Студии 10 бит» (render.py audio_chain); слышна в готовом видео
  const VOICE_ON = { rumble: 0.5, denoise: 0.35, deess: 0.3, mud: 0.35, pres: 0.4, air: 0.2, comp: 0.5, leveler: 0.5, lufs: -14 };
  const VOICE = [["rumble", "Убрать гул и низкий шум"], ["denoise", "Убрать шум (фон, вентилятор)"], ["deess", "Смягчить «с» и «ш»"], ["mud", "Убрать бубнение"],
    ["body", "Плотность голоса", -1], ["pres", "Разборчивость", -1], ["air", "Воздух, звонкость", -1], ["comp", "Ровнее по громкости"], ["leveler", "Подтянуть тихие фразы"]];
  let voiceOpen = false;
  function voiceBox() {
    const v = P.voice, on = Object.keys(VOICE_ON).some((k) => v[k]);
    const ch = (fn) => { begin(); fn(); renderPanel(); save(); };
    return [
      h("div.row-btns", {}, h("button.btn.sm" + (on ? ".primary" : ""), { onclick: () => ch(() => { P.voice = on ? {} : { ...VOICE_ON }; }) }, on ? "Голос улучшен ✓" : "Улучшить голос"),
        h("button.btn.sm", { onclick: () => { voiceOpen = !voiceOpen; renderPanel(); } }, voiceOpen ? "Скрыть настройку" : "Тонкая настройка")),
      voiceOpen ? [
        ...VOICE.map(([k, label, min]) => slider(label, () => P.voice[k] || 0, (x) => { P.voice[k] = x; }, { min: min ?? 0, max: 1, def: 0, show: (x) => Math.round(x * 100) })),
        h("button.check" + (v.dehum ? ".on" : ""), { onclick: () => ch(() => { v.dehum = v.dehum ? 0 : 50; }) }, h("i", {}, v.dehum ? icon("check", 14) : null), "Убрать гудение сети 50 Гц"),
        h("button.check" + (v.lufs ? ".on" : ""), { onclick: () => ch(() => { v.lufs = v.lufs ? 0 : -14; }) }, h("i", {}, v.lufs ? icon("check", 14) : null), "Громкость как в соцсетях (−14 LUFS)")] : null,
      h("p.hint", {}, on ? "Обработка голоса слышна в готовом видео; в превью звучит исходник." : "Одна кнопка — убирает гул и шум, делает голос разборчивее и ровнее. Слышно в готовом видео.")].flat().filter(Boolean);
  }
  // кадр пальцами на превью
  const ptrs = new Map(); let g0 = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (full) return;   // на полном экране видео только смотрим
    const cl = panel === "cloud" && P.clouds.find((x) => x.id === cloudSel);
    const mk = panel === "mask" && target()?.mask;
    if (panel === "overlay" && ptrs.size === 0) {   // выбрать наложение пальцем прямо на видео
      const r = canvas.getBoundingClientRect(), hit = ovAt(P.overlays, t, r.width, r.height, e.clientX - r.left, e.clientY - r.top, ovSize);
      if (hit && hit.id !== ovSel) selectOverlay(hit.id);
    }
    if (panel === "text" && ptrs.size === 0) {   // выбрать титр пальцем: ближайший к точке из видимых сейчас
      const r = canvas.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      let best = null, bd = 0.12;
      for (const x of P.texts) if (t >= x.start && t < x.end) { const st = normStyle({ ...TEXT_DEFAULT, ...x.style }), d = Math.hypot((px - st.x) * 0.5, py - st.y); if (d < bd) { bd = d; best = x; } }
      if (best && best.id !== txtSel) selectText(best.id);
    }
    const tx = panel === "text" && P.texts.find((x) => x.id === txtSel && t >= x.start && t < x.end);
    const ov = panel === "overlay" && P.overlays.find((x) => x.id === ovSel && t >= x.start && t < x.end);
    const mode = panel === "frame" ? "frame" : tx ? "txt" : ov ? "ov" : mk ? "mask" : cl ? "cloud" : panel === "subs" && P.subs?.on && lines.length ? "subs" : null;
    if (!mode) { if (ptrs.size === 0) toggle(); return; }
    const c = mode === "frame" ? target() : null; if (mode === "frame" && !c) return;
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e);
    if (mode === "frame" && ptrs.size === 1) begin();
    const ps = [...ptrs.values()], d = ps[1] ? Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY) : 0;
    if (mode === "frame") g0 = { mode, c, fr: { ...(c.frame ||= { ...FRAME_DEFAULT }) }, x: ps[0].clientX, y: ps[0].clientY, d };
    else if (mode === "txt") { const st = normStyle({ ...TEXT_DEFAULT, ...tx.style }); g0 = { mode, x: tx, s0: { x: st.x, y: st.y, size: st.size }, px: ps[0].clientX, py: ps[0].clientY, x0: ps[0].clientX, y0: ps[0].clientY, d, moved: g0?.moved || false }; g0.x = ps[0].clientX; g0.y = ps[0].clientY; g0.tx = tx; }
    else if (mode === "ov") { const a = ps[1] ? Math.atan2(ps[1].clientY - ps[0].clientY, ps[1].clientX - ps[0].clientX) : 0; g0 = { mode, o: ov, s0: { x: ov.x ?? 0.5, y: ov.y ?? 0.5, scale: ov.scale ?? OV_DEFAULT.scale, rot: ov.rot || 0 }, a, x: ps[0].clientX, y: ps[0].clientY, d, moved: g0?.moved || false }; }
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
    } else if (g0.mode === "txt") {
      if (!g0.moved) { if (!k && Math.hypot(dx * r.width, dy * r.height) < 5) return; g0.moved = true; pause(); begin(); }
      const st = (g0.tx.style ||= {});
      if (k) st.size = clamp(g0.s0.size * k, 0.02, 0.3);
      else { const x = clamp(g0.s0.x + dx, 0.05, 0.95); st.x = Math.abs(x - 0.5) < 0.02 ? 0.5 : x; st.y = clamp(g0.s0.y + dy, 0.03, 0.97); }
    } else if (g0.mode === "ov") {
      if (!g0.moved) { if (!k && Math.hypot(dx * r.width, dy * r.height) < 5) return; g0.moved = true; pause(); begin(); }
      const o = g0.o;
      if (k) { o.scale = clamp(g0.s0.scale * k, 0.03, 4); const a = Math.atan2(ps[1].clientY - ps[0].clientY, ps[1].clientX - ps[0].clientX); let rot = g0.s0.rot + (a - g0.a) * 180 / Math.PI; rot = ((rot + 540) % 360) - 180; o.rot = Math.abs(rot) < 3 ? 0 : Math.round(rot); }
      else { const x = clamp(g0.s0.x + dx, -0.5, 1.5), y = clamp(g0.s0.y + dy, -0.5, 1.5); o.x = Math.abs(x - 0.5) < 0.015 ? 0.5 : x; o.y = Math.abs(y - 0.5) < 0.015 ? 0.5 : y; }
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
    if ((g?.mode === "ov" || g?.mode === "txt") && !g.moved) return;
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
  // ——— полноэкранный просмотр
  let full = false, fsT = 0;
  function fsUpd() { if (!full) return; fsTime.textContent = fmtTime(t) + " / " + fmtTime(total()); fsSeek.max = total() || 1; fsSeek.value = t; }
  function fsShow(stay) { ed.classList.remove("fs-idle"); clearTimeout(fsT); if (!stay && playing) fsT = setTimeout(() => ed.classList.add("fs-idle"), 2500); }
  function fsHide() { clearTimeout(fsT); fsT = setTimeout(() => ed.classList.add("fs-idle"), 2500); }
  const fsDoc = () => document.fullscreenElement || document.webkitFullscreenElement;
  function setFull(on) {
    if (on === full) return;
    full = on; ed.classList.toggle("full", on); ed.classList.remove("fs-idle");
    if (on) {
      sel = null; if (panel) { panel = null; renderPanel(); }
      const rq = ed.requestFullscreen || ed.webkitRequestFullscreen;   // системный полный экран, где браузер позволяет (iPad, компьютер)
      if (rq) try { const p = rq.call(ed); p && p.catch && p.catch(() => {}); } catch {}
      fsShow(!playing);
    } else if (fsDoc()) { const ex = document.exitFullscreen || document.webkitExitFullscreen; try { const p = ex.call(document); p && p.catch && p.catch(() => {}); } catch {} }
    syncBar(); layout(); requestAnimationFrame(fit);
  }
  const onFsChange = () => { if (full && !fsDoc()) setFull(false); };
  document.addEventListener("fullscreenchange", onFsChange); document.addEventListener("webkitfullscreenchange", onFsChange);
  view.addEventListener("click", () => { if (!full) return; if (ed.classList.contains("fs-idle")) fsShow(); else toggle(); });
  const onFsKey = (e) => { if (full && e.key === "Escape") setFull(false); };
  document.addEventListener("keydown", onFsKey);

  function exit() {
    setFull(false); document.removeEventListener("keydown", onFsKey);
    document.removeEventListener("fullscreenchange", onFsChange); document.removeEventListener("webkitfullscreenchange", onFsChange);
    pause(); clearTimeout(saveT); clearTimeout(pushT); clearInterval(remoteTimer);
    if (dirty && cloud.signedIn()) pushProject({ ...P, updated: Date.now() }).catch(() => {});
    alive = false; ro.disconnect(); offMedia(); document.removeEventListener("keydown", onKey);
    for (const r of vids.values()) { r.v.src = ""; r.v.remove(); }
    for (const r of ovVids.values()) if (r.v) { r.v.src = ""; r.v.remove(); }
    for (const r of sndEls.values()) if (r.el) { r.el.pause(); r.el.src = ""; }
    P.updated = Date.now(); P.duration = total();
    db.put("projects", P).finally(onExit);
  }

  layout(); fit(); syncBar();
  if (P.clips.length) pps = clamp((scroll.clientWidth * 0.8) / Math.max(1, total()), 3, 240);
  await loadAll();
  // для автопроверок
  window.__ed = { P, seek, srcAt, rateAt, pause, recOf: (k) => vids.get(k), quickEdit, trList, addText, get txtSel() { return txtSel; }, addSound, get sndSel() { return sndSel; }, get sndEls() { return sndEls; }, addOverlayImage, addOverlayVideo, get ovSel() { return ovSel; }, checkRemote, push, get cloudSel() { return cloudSel; }, get lines() { return lines; }, subApi, get t() { return t; }, get playing() { return playing; }, total, get sel() { return sel; }, get panel() { return panel; } };
}
