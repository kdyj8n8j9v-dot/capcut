// Мелкие помощники интерфейса: элементы, значки, листы (окна снизу), сообщения.
export function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split(".");
  const e = document.createElement(name || "div");
  if (cls.length) e.className = cls.join(" ");
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const P = {
  back: "M15 5l-7 7 7 7", gear: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 00-1.8-1L15 3.5h-4l-.4 2.6a7.5 7.5 0 00-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 001.8 1l.3 2.6h4l.4-2.6a7.5 7.5 0 001.7-1l2.4 1 2-3.4z",
  plus: "M12 5v14M5 12h14", play: "M8 5v14l11-7z", pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  undo: "M9 7L4 12l5 5M4 12h10a6 6 0 010 12h-1", redo: "M15 7l5 5-5 5M20 12H10a6 6 0 000 12h1",
  split: "M12 3v18M7 8l-3 4 3 4M17 8l3 4-3 4", trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  crop: "M7 3v14h14M3 7h14v14", color: "M12 3a9 9 0 100 18c1.5 0 2-1 2-2s-.7-1.6-.7-2.5c0-1 .8-1.5 1.7-1.5H17a4 4 0 004-4c0-4.4-4-8-9-8zM7.5 12.5h.01M9.5 8h.01M14.5 7.5h.01",
  share: "M12 15V3M8 7l4-4 4 4M5 12v8h14v-8", cloud: "M7 18a4.5 4.5 0 01-.6-9A6 6 0 0118 10.5 3.8 3.8 0 0117.5 18z",
  device: "M8 3h8a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V5a2 2 0 012-2zM11 18h2", check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18", film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9.7h4M4 14.3h4M16 9.7h4M16 14.3h4", more: "M6 12h.01M12 12h.01M18 12h.01",
  zoomin: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4M11 8v6M8 11h6", zoomout: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4M8 11h6",
  sound: "M4 10v4h3l5 4V6l-5 4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11", down: "M12 4v12M7 11l5 5 5-5M5 20h14",
};
export function icon(name, size = 24) {
  const fill = name === "play" || name === "pause";
  return h("span.ic", { html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${P[name]}"/></svg>` });
}
const layer = () => document.getElementById("layer");
// Лист: окно поверх экрана (на iPhone выезжает снизу, на iPad — по центру). Возвращает { el, body, close }.
export function sheet(title, body, { onclose, wide } = {}) {
  const close = () => { if (!back.isConnected) return; back.remove(); onclose && onclose(); };
  const box = h("div.sheet" + (wide ? ".wide" : ""), { role: "dialog", "aria-label": title },
    h("div.sheet-head", {}, h("div.sheet-title", {}, title), h("button.round", { onclick: close, "aria-label": "Закрыть" }, icon("close", 18))),
    h("div.sheet-body", {}, body));
  const back = h("div.backdrop", { onpointerdown: (e) => { if (e.target === back) close(); } }, box);
  layer().append(back);
  return { el: box, body: box.querySelector(".sheet-body"), close };
}
let toastT;
export function toast(msg, ms = 2600) {
  document.querySelector(".toast")?.remove();
  const t = h("div.toast", {}, msg);
  layer().append(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), ms);
}
export function ask(title, text, okLabel = "Удалить", danger = true) {
  return new Promise((res) => {
    let done = false;
    const s = sheet(title, [
      text && h("p.muted", {}, text),
      h("div.row-btns", {},
        h("button.btn", { onclick: () => s.close() }, "Отмена"),
        h("button.btn" + (danger ? ".danger" : ".primary"), { onclick: () => { done = true; s.close(); } }, okLabel)),
    ], { onclose: () => res(done) });
  });
}
export function askText(title, value, placeholder = "") {
  return new Promise((res) => {
    let out = null;
    const inp = h("input.field", { value, placeholder, onkeydown: (e) => { if (e.key === "Enter") ok(); } });
    const ok = () => { out = inp.value.trim(); s.close(); };
    const s = sheet(title, [inp, h("div.row-btns", {}, h("button.btn", { onclick: () => s.close() }, "Отмена"), h("button.btn.primary", { onclick: ok }, "Готово"))],
      { onclose: () => res(out) });
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}
export const fmtTime = (t, frac = false) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}` + (frac ? "," + Math.floor((t % 1) * 10) : "");
};
export const fmtSize = (b) => b >= 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " ГБ" : Math.max(1, Math.round(b / 1e6)) + " МБ";
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(9).filter((k) => k != null && k !== false));
