// Сборщик: слой субтитров как видео с прозрачностью (только полоса кадра, где они находятся).
//   node worker/subs.mjs <project.json> <out.mov> <fps, напр. 50/1> <W> <H> <кадров>   → печатает {"y":…,"h":…}
// Рисует тот же код, что и превью в приложении (app/js/subs.mjs). Текст в журнал не пишется.
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { drawSubs, drawClouds, band, FONTS } from "../app/js/subs.mjs";

const [, , proj, out, fpsS, Ws, Hs, Ns] = process.argv;
const W = +Ws, H = +Hs, N = +Ns, [fn, fd] = fpsS.split("/").map(Number), fps = fn / (fd || 1);
const { style, lines = [], fonts, clouds = [] } = JSON.parse(fs.readFileSync(proj, "utf8")).subs;
for (const f of fonts || []) if (f.file && fs.existsSync(f.file)) GlobalFonts.registerFromPath(f.file, f.name);   // свой шрифт владельца из MEGA
for (const [name, file] of Object.entries(FONTS)) GlobalFonts.registerFromPath(fileURLToPath(new URL("../app/fonts/" + file, import.meta.url)), name);
const b = band(W, H, style, lines, clouds);
const cv = createCanvas(W, b.h), ctx = cv.getContext("2d");
const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${b.h}`, "-r", fpsS, "-i", "-", "-c:v", "qtrle", "-pix_fmt", "argb", out], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((res, rej) => ff.on("close", (c) => c ? rej(new Error("ffmpeg " + c)) : res()));
const blank = Buffer.alloc(W * b.h * 4);
for (let n = 0; n < N; n++) {
  ctx.clearRect(0, 0, W, b.h);
  ctx.save(); ctx.translate(0, -b.y);
  const c1 = drawClouds(ctx, W, H, n / fps, clouds), c2 = drawSubs(ctx, W, H, n / fps, lines, style), any = c1 || c2;
  ctx.restore();
  const buf = any ? Buffer.from(ctx.getImageData(0, 0, W, b.h).data.buffer) : blank;
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
}
ff.stdin.end();
await done;
console.log(JSON.stringify(b));
