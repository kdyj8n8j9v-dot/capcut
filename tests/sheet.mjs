// Контактный лист: все шаблоны и анимации субтитров движком сборщика. node tests/sheet.mjs out.png
import { createCanvas, GlobalFonts } from "@napi-rs/canvas"; import fs from "fs";
import { drawSubs, FONTS, PRESETS, ANIM_IN, ANIM_OUT, ANIM_LOOP, HL } from "../app/js/subs.mjs";
for (const [n, f] of Object.entries(FONTS)) GlobalFonts.registerFromPath(new URL("../app/fonts/", import.meta.url).pathname + f, n);
const W = 360, H = 150, line = [{ start: 0, end: 2, words: [{ text: "Привет,", start: 0.1, end: 0.6 }, { text: "это", start: 0.6, end: 1.0, em: true }, { text: "проверка", start: 1.0, end: 1.6 }] }];
const cells = [];
for (const [n, v] of PRESETS) cells.push([n, { ...v, size: 0.085, maxChars: 30 }, 0.8]);
for (const [k, n] of ANIM_IN) cells.push(["вход: " + n, { in: k, inDur: 0.6, hl: "none", size: 0.085, maxChars: 30 }, 0.32]);
for (const [k, n] of ANIM_OUT) cells.push(["выход: " + n, { out: k, outDur: 0.6, in: "none", hl: "none", size: 0.085, maxChars: 30 }, 1.7]);
for (const [k, n] of ANIM_LOOP) cells.push(["цикл: " + n, { loop: k, in: "none", hl: "none", size: 0.085, maxChars: 30 }, 0.9]);
for (const [k, n] of HL) cells.push(["слова: " + n, { hl: k, in: "none", size: 0.085, maxChars: 30 }, 0.85]);
cells.push(["фон+тень+курсив", { bg: 0.7, shadow: 0.8, italic: true, stroke: 0, ls: 0.05, size: 0.08, maxChars: 30, in: "none" }, 0.8]);
const cols = 5, rows = Math.ceil(cells.length / cols), cv = createCanvas(cols * W, rows * H), c = cv.getContext("2d");
cells.forEach(([name, st, t], i) => {
  const x = (i % cols) * W, y = Math.floor(i / cols) * H;
  c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, W, H); c.clip();
  c.fillStyle = i % 2 ? "#2d4a6b" : "#5a3d5c"; c.fillRect(0, 0, W, H);
  drawSubs(c, W, H, t, line, { ...st, y: 0.6 });
  c.fillStyle = "#fff"; c.font = "13px Inter"; c.fillText(name, 6, 16); c.restore();
});
fs.writeFileSync(process.argv[2], cv.toBuffer("image/png"));
