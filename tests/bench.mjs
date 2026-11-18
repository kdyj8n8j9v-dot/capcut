// Замер плавности воспроизведения со скоростью: node tests/bench.mjs [видео.webm]
// Считает, сколько раз время на таймлайне стояло дольше 150 мс, и сколько новых кадров видео показано в секунду.
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "fs";
const fake = fs.readFileSync(new URL("./fake.js", import.meta.url), "utf8");
const sample = process.argv[2] || "tests/sample.webm";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
page.on("pageerror", (e) => console.log("ошибка:", e.message));
await page.route("**/tests/sample.webm", (r) => r.fulfill({ body: fs.readFileSync(sample), contentType: "video/webm" }));
await page.addInitScript(fake);
await page.goto("http://127.0.0.1:8765/app/");
await page.click(".setup");
await page.fill('input[type=email]', "me@example.com"); await page.fill('input[placeholder="Пароль MEGA"]', "верный"); await page.click("text=Войти");
await page.waitForSelector("text=Вход выполнен");
await page.click("summary"); await page.fill('input[placeholder^="Токен"]', "github_pat_ok"); await page.click("text=Сохранить и проверить");
await page.waitForSelector("text=Токен сохранён"); await page.click('.sheet [aria-label="Закрыть"]'); await page.waitForTimeout(300);
await page.click(".card.new"); await page.click(".empty .btn");
await page.click(".lib .item >> text=Съёмка 1.mov"); await page.waitForSelector(".lib .badge.on"); await page.click(".lib-foot .btn");
await page.waitForFunction(() => window.__ed && window.__ed.total() > 5);
await page.evaluate(() => document.querySelector(".sheet [aria-label=Закрыть]")?.click());
await page.waitForTimeout(1500);
const cases = [["1×", {}], ["0,5×", { speed: 0.5 }], ["2×", { speed: 2 }], ["4×", { speed: 4 }],
  ["кривая Монтаж", { curve: [[0, 1], [0.25, 3], [0.5, 0.4], [0.75, 3], [1, 1]] }], ["кривая Вспышка", { curve: [[0, 5], [0.3, 4], [0.5, 1], [1, 1]] }]];
for (const [name, set] of cases) {
  const r = await page.evaluate(async (set) => {
    const E = window.__ed, c = E.P.clips[0]; delete c.speed; delete c.curve; Object.assign(c, set);
    E.seek(0.01); await new Promise((r) => setTimeout(r, 400));
    const v = [...document.querySelectorAll("video.src")].find((x) => x.src); let frames = 0, seeks = 0, maxGapF = 0, lastF = performance.now();
    const onF = () => { const n = performance.now(); maxGapF = Math.max(maxGapF, n - lastF); lastF = n; frames++; v.requestVideoFrameCallback(onF); };
    v.requestVideoFrameCallback(onF); v.addEventListener("seeking", () => seeks++);
    document.querySelector('[aria-label="Пуск"]').click();
    const T0 = performance.now(); let lastT = E.t, lastMove = T0, maxStall = 0, stalls = 0;
    while (performance.now() - T0 < 3000 && E.playing) {
      await new Promise((r) => requestAnimationFrame(r));
      const n = performance.now();
      if (E.t !== lastT) { const g = n - lastMove; if (g > 150) stalls++; maxStall = Math.max(maxStall, g); lastMove = n; lastT = E.t; }
    }
    const dur = (performance.now() - T0) / 1000, tEnd = E.t;
    E.pause();
    return { dur: dur.toFixed(1), t: tEnd.toFixed(2), fps: (frames / dur).toFixed(0), maxGapFrame: Math.round(maxGapF), stalls, maxStall: Math.round(maxStall), seeks };
  }, set);
  console.log(name.padEnd(16), JSON.stringify(r));
}
await browser.close();
