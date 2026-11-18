// Избранное (звёздочка на плитке; избранные — первыми) и выбор кривой движения анимации.
import { h } from "./ui.js";
import { settings } from "./store.js";
import { ease, EASES } from "./subs.mjs";

const all = () => settings.get("fav") || {};
export const isFav = (kind, id) => (all()[kind] || []).includes(id);
export function toggleFav(kind, id) {
  const f = all(), l = f[kind] || [];
  f[kind] = l.includes(id) ? l.filter((x) => x !== id) : [id, ...l];
  settings.set("fav", f);
}
// звёздочка в углу плитки; onChange — перерисовать список
export const favStar = (kind, id, onChange) => h("span.star" + (isFav(kind, id) ? ".on" : ""), { role: "button", "aria-label": isFav(kind, id) ? "Убрать из избранного" : "В избранное",
  onclick: (e) => { e.stopPropagation(); e.preventDefault(); toggleFav(kind, id); onChange && onChange(); } }, isFav(kind, id) ? "★" : "☆");
// избранные — в начало, остальные — как были
export function favSort(kind, list, id = (x) => x[0]) {
  const f = all()[kind] || [];
  return [...list].sort((a, b) => { const ia = f.indexOf(id(a)), ib = f.indexOf(id(b)); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); });
}
// маленький график кривой движения
export function easeIcon(name) {
  const pts = Array.from({ length: 41 }, (_, i) => { const p = i / 40, y = name === "auto" ? 1 - Math.pow(1 - p, 3) : ease(name, p); return `${(4 + p * 52).toFixed(1)},${(26 - y * 20).toFixed(1)}`; }).join(" ");
  return h("span.cv", { html: `<svg viewBox="0 0 60 32" width="54" height="29"><line x1="4" x2="56" y1="6" y2="6" stroke="rgba(255,255,255,.2)" stroke-dasharray="2 2"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>` });
}
export function easePicker(cur, pick, label = "Как движется") {
  return [h("div.sl-top", {}, label), h("div.tiles.curves.eases", {}, EASES.map(([k, n]) => h("button" + ((cur || "auto") === k ? ".on" : ""), { onclick: () => pick(k) }, easeIcon(k), h("span", {}, n))))];
}
