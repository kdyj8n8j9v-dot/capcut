// Редактор: превью, таймлайн (резка, обрезка краёв, перестановка), кадр, цвет, звук.
import { h, icon, sheet, toast, askText, fmtTime, clamp } from "./ui.js";
import { db, uid } from "./store.js";
import { createRenderer, GRADE_DEFAULT, FRAME_DEFAULT, HSL_BANDS } from "./gl.js";
import { mediaUrl, library, ensure, onMedia, busyOf } from "./media.js";
import { cloud } from "./cloud.js";
import { openLibrary } from "./library.js";
import { openExport } from "./export.js";

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
  P.clips ||= []; P.media ||= {}; P.grade ||= {}; P.format ||= "9:16"; P.volume ??= 1;
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
  const snap = () => JSON.stringify({ clips: P.clips, grade: P.grade, format: P.format, volume: P.volume });
  let saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { P.updated = Date.now(); P.duration = total(); db.put("projects", P).catch(() => {}); }, 300);
  }
  function begin() { const s = snap(); if (undo[undo.length - 1] !== s) undo.push(s); if (undo.length > 100) undo.shift(); redo.length = 0; syncBar(); }
  function restore(from, to) {
    if (!from.length) return;
    to.push(snap());
    Object.assign(P, JSON.parse(from.pop()));
    if (!P.clips.some((c) => c.id === sel)) sel = null;
    pause(); layout(); seek(Math.min(t, total())); renderPanel(); syncBar(); save();
  }

  // ——— экран
  const canvas = h("canvas");
  const R = createRenderer(canvas);
  const empty = h("div.empty", {},
    h("div.empty-title", {}, "Начните с видео"),
    h("div.muted", {}, "Возьмите его из MEGA или с этого устройства."),
    h("button.btn.primary.big", { onclick: addMedia }, icon("plus", 20), "Добавить видео"));
  const view = h("div.view", {}, canvas, empty);
  const side = h("aside.panel", { hidden: true });
  const tNow = h("span.t-now", {}, "0:00,0"), tAll = h("span.t-all", {}, "0:00");
  const playBtn = h("button.round.play", { onclick: toggle, "aria-label": "Пуск" }, icon("play", 22));
  const scroll = h("div.tl-scroll"), ruler = h("div.tl-ruler"), track = h("div.tl-track"), inner = h("div.tl-inner", {}, ruler, track);
  scroll.append(inner);
  const titleBtn = h("button.title", { onclick: rename }, P.name);
  const fmtBtn = h("button.chip", { onclick: pickFormat, "aria-label": "Формат" }, P.format);
  const undoBtn = h("button.round", { onclick: () => restore(undo, redo), "aria-label": "Отменить" }, icon("undo", 20));
  const redoBtn = h("button.round", { onclick: () => restore(redo, undo), "aria-label": "Вернуть" }, icon("redo", 20));
  const tool = (id, ic, label, fn) => h("button.tool", { "data-tool": id, onclick: fn }, icon(ic), h("span", {}, label));
  const tools = h("nav.tools", {},
    tool("media", "plus", "Медиа", addMedia), tool("split", "split", "Разрезать", split),
    tool("frame", "crop", "Кадр", () => openPanel("frame")), tool("color", "color", "Цвет", () => openPanel("color")),
    tool("sound", "sound", "Звук", () => openPanel("sound")), tool("delete", "trash", "Удалить", remove));
  const ed = h("div.ed", {},
    h("header.bar", {},
      h("button.link", { onclick: exit }, icon("back", 20), "Проекты"), titleBtn,
      h("div.bar-right", {}, undoBtn, redoBtn, fmtBtn, h("button.btn.primary", { onclick: doExport }, icon("share", 18), "Экспорт"))),
    h("div.stage", {}, view, side),
    h("div.transport", {}, h("div.times", {}, tNow, h("span.muted", {}, " / "), tAll), playBtn,
      h("div.zoom", {}, h("button.round", { onclick: () => zoom(1 / 1.5), "aria-label": "Мельче" }, icon("zoomout", 18)),
        h("button.round", { onclick: () => zoom(1.5), "aria-label": "Крупнее" }, icon("zoomin", 18)))),
    h("div.tl", {}, scroll, h("div.tl-head")),
    tools);
  root.replaceChildren(ed);

  function syncBar() {
    undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
    const none = !P.clips.length;
    empty.hidden = !none; canvas.hidden = none;
    for (const b of tools.children) {
      const id = b.dataset.tool;
      b.disabled = id !== "media" && none || id === "delete" && !sel;
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
    const pad = scroll.clientWidth / 2;
    inner.style.padding = `0 ${pad}px`;
    scroll.scrollLeft = t * pps;
    draw();
  }
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
    if (panel === "frame" && loc?.clip.id !== shown && !ptrs.size) renderPanel();
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
  function pause() { if (!playing) return; playing = false; for (const r of vids.values()) r.v.pause(); syncBar(); }
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
    requestAnimationFrame(tick);
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
    layoutBusy(); syncBar();
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
  scroll.addEventListener("click", (e) => { if (e.target === scroll || e.target === inner || e.target === track || e.target === ruler) { sel = null; layout(); } });
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
    const b = { ...c, id: uid(), in: cut, frame: c.frame && { ...c.frame } };
    c.out = cut;
    P.clips.splice(loc.i + 1, 0, b);
    sel = b.id; layout(); seek(t); save();
  }
  function remove() {
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
    } else if (panel === "sound") {
      side.replaceChildren(head("Звук"),
        slider("Громкость", () => P.volume, (v) => { P.volume = v; setVolume(); }, { min: 0, max: 2, def: 1, show: (v) => Math.round(v * 100) + " %" }),
        h("p.hint", {}, "Громче 100 % слышно в готовом видео; в превью звук не усиливается."));
    }
  }
  // кадр пальцами на превью
  const ptrs = new Map(); let g0 = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (panel !== "frame") { if (ptrs.size === 0) toggle(); return; }
    const c = target(); if (!c) return;
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e);
    if (ptrs.size === 1) begin();
    const fr = (c.frame ||= { ...FRAME_DEFAULT }), ps = [...ptrs.values()];
    g0 = { c, fr: { ...fr }, x: ps[0].clientX, y: ps[0].clientY, d: ps[1] ? Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY) : 0 };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId) || !g0) return;
    ptrs.set(e.pointerId, e);
    const ps = [...ptrs.values()], fr = g0.c.frame, r = canvas.getBoundingClientRect();
    if (ps.length >= 2 && g0.d) fr.scale = clamp(g0.fr.scale * Math.hypot(ps[0].clientX - ps[1].clientX, ps[0].clientY - ps[1].clientY) / g0.d, 0.2, 4);
    else { fr.x = clamp(g0.fr.x + (ps[0].clientX - g0.x) / r.width, -1, 1); fr.y = clamp(g0.fr.y + (ps[0].clientY - g0.y) / r.height, -1, 1); }
    draw();
  });
  const up = (e) => { if (!ptrs.delete(e.pointerId)) return; g0 = null; if (!ptrs.size) { renderPanel(); save(); } };
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
    pause(); alive = false; clearTimeout(saveT); ro.disconnect(); offMedia(); document.removeEventListener("keydown", onKey);
    for (const r of vids.values()) { r.v.src = ""; r.v.remove(); }
    P.updated = Date.now(); P.duration = total();
    db.put("projects", P).finally(onExit);
  }

  layout(); fit(); syncBar();
  if (P.clips.length) pps = clamp((scroll.clientWidth * 0.8) / Math.max(1, total()), 3, 240);
  await loadAll();
  // для автопроверок
  window.__ed = { P, seek, get t() { return t; }, get playing() { return playing; }, total };
}
