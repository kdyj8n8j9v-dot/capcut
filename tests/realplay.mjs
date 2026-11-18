// Настоящая проверка скорости через интерфейс, как пальцем на iPad: выбрать клип → «Скорость» → плитка/кривая → ▶.
// Видео — такое же, как лёгкая копия сборщика (H.264 1080×1920, 30 к/с, ключевой кадр каждые 15).
// Ловит: таймлайн стоит (>150 мс), картинка застыла (>250 мс), сколько кадров в секунду показано, перескоки видео.
// Видео для проверки (полоса сверху: яркость = 16 + 2·номер кадра mod 216 — по ней сверяется кадр на экране):
// ffmpeg -f lavfi -i "testsrc2=s=1080x1920:r=30:d=20,noise=alls=2:allf=t" -f lavfi -i "color=c=gray:s=1080x240:r=30:d=20,geq=lum='16+mod(N*2\,216)':cb=128:cr=128" \
//   -f lavfi -i "sine=f=440:d=20" -filter_complex "[0][1]overlay=0:0,format=yuv420p[v]" -map "[v]" -map 2:a -c:v libx264 -preset fast -crf 14 -g 15 -c:a aac копия.mp4
// Запуск: node tests/realplay.mjs копия.mp4
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "fs";
const fake = fs.readFileSync(new URL("./fake.js", import.meta.url), "utf8");
const file = process.argv[2], shots = process.env.SHOTS || "tests/shots";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.route("**/tests/sample.webm", (r) => r.fulfill({ body: fs.readFileSync(file), contentType: "video/mp4" }));
await page.addInitScript(fake);
await page.goto("http://127.0.0.1:8765/app/");
await page.click(".setup");
await page.fill('input[type=email]', "me@example.com"); await page.fill('input[placeholder="Пароль MEGA"]', "верный"); await page.click("text=Войти");
await page.waitForSelector("text=Вход выполнен");
await page.click("summary"); await page.fill('input[placeholder^="Токен"]', "github_pat_ok"); await page.click("text=Сохранить и проверить");
await page.waitForSelector("text=Токен сохранён"); await page.click('.sheet [aria-label="Закрыть"]'); await page.waitForTimeout(300);
await page.click(".card.new"); await page.click(".empty .btn");
await page.click(".lib .item >> text=Съёмка 1.mov"); await page.waitForSelector(".lib .badge.on"); await page.click(".lib-foot .btn");
await page.waitForFunction(() => window.__ed && window.__ed.total() > 15, null, { timeout: 30000 });
if (await page.locator(".panel-head >> text=Готово").count()) await page.click(".panel-head >> text=Готово");
await page.waitForTimeout(1500);

// сбор: каждый кадр экрана — время таймлайна и «отпечаток» картинки превью
await page.evaluate(() => {
  const cv = document.querySelector(".view canvas"), g = cv.getContext("webgl");
  const b = new Uint8Array(4 * 16);
  window.__probe = { on: false, log: [] };
  const v0 = () => [...document.querySelectorAll("video.src")].find((x) => x.src);
  let frames = 0; const vv = v0(); const f = () => { frames++; vv.requestVideoFrameCallback(f); }; vv.requestVideoFrameCallback(f);
  let seeks = 0; vv.addEventListener("seeking", () => seeks++);
  const loop = () => {
    if (window.__probe.on) {
      // полоса сверху видео меняет яркость каждый кадр — по ней видно, обновилась ли картинка превью
      g.readPixels(cv.width >> 1, (cv.height * 0.97) | 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, b); const hsh = b[0] >> 2;
      // какой кадр исходника на экране (по яркости полосы: 16 + 2·N mod 216) и какой должен быть по таймлайну
      const E = window.__ed, c = E.P.clips[0], want = Math.floor(E.srcAt(c, Math.min(E.t, E.total())) * 30 + 0.5);
      const Y = b[0] * 219 / 255 + 16, k = (Y - 16) / 2, ke = want % 108;
      let d = ((k - ke) % 108 + 108) % 108; if (d > 54) d -= 108;
      window.__probe.log.push([performance.now(), E.t, hsh, frames, seeks, E.playing, d]);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const measure = async (name, ms = 3000) => {
  await page.evaluate(() => { window.__probe.log = []; window.__probe.on = true; });
  await page.tap('[aria-label="Пуск"]');
  for (let i = 1; i <= 2; i++) { await page.waitForTimeout(ms / 3); await page.screenshot({ path: `${shots}/real-${name.replace(/\W+/g, "_")}-${i}.png` }); }
  await page.waitForTimeout(ms / 3);
  const r = await page.evaluate(() => {
    window.__probe.on = false; const L = window.__probe.log.filter((x) => x[5]);
    if (L.length < 2) return { err: "не играло", n: L.length };
    let stallT = 0, maxT = 0, lastTc = L[0][0], frozen = 0, maxF = 0, lastHc = L[0][0];
    for (let i = 1; i < L.length; i++) {
      if (L[i][1] !== L[i - 1][1]) { const g = L[i][0] - lastTc; if (g > 150) stallT++; maxT = Math.max(maxT, g); lastTc = L[i][0]; }
      if (L[i][2] !== L[i - 1][2]) { const g = L[i][0] - lastHc; if (g > 250) frozen++; maxF = Math.max(maxF, g); lastHc = L[i][0]; }
    }
    const dur = (L.at(-1)[0] - L[0][0]) / 1000;
    const ds = L.slice(5).map((x) => x[6]), avg = ds.reduce((a, x) => a + x, 0) / ds.length, mx = Math.max(...ds.map(Math.abs));
    return { сек: +dur.toFixed(1), таймлайн: +(L.at(-1)[1] - L[0][1]).toFixed(2), стоп_таймлайна: stallT, макс_стоп_мс: Math.round(maxT),
      застывала_картинка: frozen, макс_застывание_мс: Math.round(maxF), кадров_в_сек: Math.round((L.at(-1)[3] - L[0][3]) / dur), перескоков: L.at(-1)[4] - L[0][4], экран_к_с: Math.round(L.length / dur),
      расхождение_кадров_ср: +avg.toFixed(1), расхождение_макс: Math.round(mx),
      плохие: L.slice(5).filter((x) => Math.abs(x[6]) > 12).map((x) => [+x[1].toFixed(2), Math.round(x[6])]).slice(0, 8), длина: +window.__ed.total().toFixed(2) };
  });
  if (await page.evaluate(() => window.__ed.playing)) await page.tap('[aria-label="Пуск"]');
  console.log(name.padEnd(34), JSON.stringify(r));
  await page.waitForTimeout(400);
};
const seek0 = () => page.evaluate(() => window.__ed.seek(0.5));
const only = process.env.ONLY;
await seek0(); await measure("1× (без изменений)");
// выбрать клип пальцем и открыть «Скорость»
await page.locator(".tl-track .clip").first().tap();
await page.tap("nav.clipbar [data-tool=speed]");
for (const v of ["2×", "4×", "0,5×", "1,5×"]) {
  await page.tap(`.panel .tiles >> text=${v}`); await page.waitForTimeout(300); await seek0();
  await measure(`Скорость ${v}, панель открыта`);
}
// ползунок «Точно»
await page.locator('input[aria-label="Точно"]').fill("3.2"); await page.locator('input[aria-label="Точно"]').dispatchEvent("change");
await seek0(); await measure("ползунок 3,2×");
await page.tap(".panel .seg >> text=Кривая");
for (const k of ["montage", "hero", "flashIn", "custom"]) {
  await page.tap(`.tiles.curves button[data-curve=${k}]`); await page.waitForTimeout(300); await seek0();
  await measure(`Кривая ${k}`);
}
// потянуть точку и сразу играть
const cv = await page.locator("canvas.curve").boundingBox();
await page.mouse.move(cv.x + cv.width * 0.5, cv.y + cv.height * 0.62); await page.mouse.down();
await page.mouse.move(cv.x + cv.width * 0.5, cv.y + cv.height * 0.15, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(300); await seek0(); await measure("после перетаскивания точки");
await page.tap(".curve-box >> text=Точка"); await seek0(); await measure("после «+ Точка»");
await page.tap(".panel-head >> text=Готово"); await seek0(); await measure("панель закрыта, кривая");
await page.tap("nav.clipbar [data-tool=back]"); await seek0(); await measure("клип не выбран, кривая", 6000);
console.log("кривая:", JSON.stringify(await page.evaluate(() => window.__ed.P.clips[0].curve)), "скорость на 6,7 с:", await page.evaluate(() => { const E = window.__ed, c = E.P.clips[0]; return E.rateAt ? E.rateAt(c, 6.7) : "?"; }));
console.log(errors.length ? "ОШИБКИ: " + errors.join(" | ") : "ошибок в консоли нет");
await browser.close();
