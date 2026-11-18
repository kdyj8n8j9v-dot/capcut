// Сборщик: слой субтитров, облаков, масок и наложений как видео с прозрачностью (только полоса кадра, где он нужен).
//   node worker/subs.mjs <project.json> <out.mov> <fps, напр. 50/1> <W> <H> <кадров>   → печатает {"y":…,"h":…}
// Рисует тот же код, что и превью в приложении (app/js/subs.mjs). Текст в журнал не пишется.
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { drawSubs, drawClouds, drawMaskCached, drawTransitions, band, FONTS } from "../app/js/subs.mjs";
import { drawOverlays } from "../app/js/overlays.mjs";

const [, , proj, out, fpsS, Ws, Hs, Ns] = process.argv;
const W = +Ws, H = +Hs, N = +Ns, [fn, fd] = fpsS.split("/").map(Number), fps = fn / (fd || 1);
const { style, lines = [], fonts, clouds = [], masks = [], overlays = [], transitions = [] } = JSON.parse(fs.readFileSync(proj, "utf8")).subs;
for (const f of fonts || []) if (f.file && fs.existsSync(f.file)) GlobalFonts.registerFromPath(f.file, f.name);   // свой шрифт владельца из MEGA
for (const [name, file] of Object.entries(FONTS)) GlobalFonts.registerFromPath(fileURLToPath(new URL("../app/fonts/" + file, import.meta.url)), name);
const b = masks.length || overlays.length || transitions.length ? { y: 0, h: H } : band(W, H, style, lines, clouds);   // маска и наложения — весь кадр
const cv = createCanvas(W, b.h), ctx = cv.getContext("2d");
const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${b.h}`, "-r", fpsS, "-i", "-", "-c:v", "qtrle", "-pix_fmt", "argb", out], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res, rej) => ff.on("close", (c) => c ? rej(new Error("ffmpeg " + c)) : res()));
const blank = Buffer.alloc(W * b.h * 4);

// ——— источники наложений: картинки целиком, видео — кадр за кадром из ffmpeg (размер — как на экране)
class Frames {
  constructor(o) {
    this.w = Math.max(2, Math.round(o.scale * W / 2) * 2); this.h = Math.max(2, Math.round(this.w * o.h / o.w / 2) * 2);
    this.size = this.w * this.h * 4; this.bufs = []; this.len = 0; this.ended = false; this.wait = [];
    this.p = spawn("ffmpeg", ["-v", "error", "-ss", String(o.from || 0), "-i", o.src, "-t", String(o.end - o.start + 1), "-an",
      "-vf", `fps=${fpsS},scale=${this.w}:${this.h}:flags=bicubic,format=rgba`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "ignore"] });   // ошибка при закрытии — не ошибка
    this.p.stdout.on("data", (d) => { this.bufs.push(d); this.len += d.length; if (this.len > this.size * 3) this.p.stdout.pause(); this.wake(); });
    this.p.stdout.on("end", () => { this.ended = true; this.wake(); });
    this.cv = createCanvas(this.w, this.h); this.img = this.cv.getContext("2d").createImageData(this.w, this.h); this.got = false;
  }
  wake() { const w = this.wait; this.wait = []; w.forEach((f) => f()); }
  async next() {   // следующий кадр; когда видео кончилось — остаётся последний
    while (this.len < this.size && !this.ended) await new Promise((r) => this.wait.push(r));
    if (this.len < this.size) return this.got;
    const all = this.bufs.length === 1 ? this.bufs[0] : Buffer.concat(this.bufs);
    this.img.data.set(all.subarray(0, this.size)); this.cv.getContext("2d").putImageData(this.img, 0, 0);
    const rest = all.subarray(this.size); this.bufs = rest.length ? [rest] : []; this.len = rest.length;
    if (this.len < this.size * 2) this.p.stdout.resume();
    return (this.got = true);
  }
  close() { try { this.p.kill(); } catch {} }
}
const srcs = new Map();
for (const o of overlays) {
  if (o.kind === "image" && o.file && fs.existsSync(o.file)) { try { const img = await loadImage(fs.readFileSync(o.file)); srcs.set(o, { img, w: img.width, h: img.height }); } catch {} }
}
const ovSrc = (o) => srcs.get(o) || null;
const make = (w, h) => createCanvas(w, h);
for (let n = 0; n < N; n++) {
  ctx.clearRect(0, 0, W, b.h);
  ctx.save(); ctx.translate(0, -b.y);
  const tm = (n + 0.5) / fps, mk = masks.find((m) => tm >= m.start && tm < m.end), c0 = drawMaskCached(ctx, W, H, mk && { ...mk, start: 0, end: 0 }, make);
  for (const o of overlays) {
    if (o.kind !== "video" || !o.src || !o.w) continue;
    const on = n / fps >= o.start && n / fps < o.end;
    let f = srcs.get(o);
    if (on && !f && !o.dead) { f = new Frames(o); srcs.set(o, f); f.src = { img: f.cv, w: o.w, h: o.h }; }
    if (on && f && !(await f.next())) { f.close(); o.dead = true; srcs.set(o, null); }   // видео не читается — без него
    if (!on && f && n / fps >= o.end) { f.close(); srcs.set(o, null); }
  }
  const cO = drawOverlays(ctx, W, H, n / fps, overlays, (o) => { const s = ovSrc(o); return s && s.src ? s.src : s; }, make);
  const cT = drawTransitions(ctx, W, H, n / fps, transitions);   // переход закрывает видео и наложения, но не текст
  const c1 = drawClouds(ctx, W, H, n / fps, clouds), c2 = drawSubs(ctx, W, H, n / fps, lines, style), any = c0 || cO || cT || c1 || c2;
  ctx.restore();
  const buf = any ? Buffer.from(ctx.getImageData(0, 0, W, b.h).data.buffer) : blank;
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
}
ff.stdin.end();
for (const f of srcs.values()) if (f && f.close) f.close();   // видео-наложения, которые шли до конца ролика
await done;
console.log(JSON.stringify(b));
process.exit(0);   // ничего не должно держать сборку
