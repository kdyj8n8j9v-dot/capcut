// Где уходит время каждого кадра при воспроизведении (процессор замедлен, как у планшета под нагрузкой).
// node tests/perf.mjs копия.mp4 [замедление=4]
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "fs";
const fake = fs.readFileSync(new URL("./fake.js", import.meta.url), "utf8");
const file = process.argv[2], slow = +(process.argv[3] || 4);
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("ошибка:", e.message));
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
// как в настоящем проекте: субтитры и свой текст
await page.click("nav.tools [data-tool=subs]").catch(() => {});
await page.click("text=Создать субтитры").catch(() => {});
await page.waitForFunction(() => window.__ed.lines.length > 0, null, { timeout: 30000 }).catch(() => console.log("субтитров нет"));
await page.evaluate(() => { window.__ed.seek(1); window.__ed.addText(); });
if (await page.locator(".panel-head >> text=Готово").count()) await page.click(".panel-head >> text=Готово");
await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: slow });
for (const sp of [1, 2, 4]) {
  await page.evaluate((sp) => { const c = window.__ed.P.clips[0]; if (sp === 1) delete c.speed; else c.speed = sp; window.__ed.seek(0.3); }, sp);
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    window.__perf = []; window.__perfD = []; window.__perfG = []; const iv = []; let last = performance.now(), on = true;
    const loop = (n) => { iv.push(n - last); last = n; if (on) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    let lt = 0; const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt += e.duration; }); try { po.observe({ type: "longtask" }); } catch {}
    document.querySelector('[aria-label="Пуск"]').click();
    await new Promise((r) => setTimeout(r, 4000));
    on = false; window.__ed.pause(); po.disconnect();
    const P = window.__perf; window.__perf = null; const D = window.__perfD; window.__perfD = null;
    const dv = (i) => +(D.reduce((a, x) => a + x[i], 0) / D.length).toFixed(1);
    const avg = (i) => +(P.reduce((a, x) => a + x[i], 0) / P.length).toFixed(1), mx = (i) => +Math.max(...P.map((x) => x[i])).toFixed(1);
    const sorted = iv.slice(2).sort((a, b) => a - b);
    return { кадров_экрана_в_с: Math.round(iv.length / 4), пропусков_кадра: iv.filter((x) => x > 25).length, худший_кадр_мс: Math.round(sorted.at(-1)), медиана_мс: Math.round(sorted[sorted.length >> 1]),
      прокрутка_мс: [avg(0), mx(0)], синхр_мс: [avg(1), mx(1)], рисование_мс: [avg(2), mx(2)], видео_логика_мс: [avg(3), mx(3)], долгие_задачи_мс: Math.round(lt), рисование_по_частям: { видео_цвет: dv(0), маски_наложения: dv(1), субтитры: dv(2), текст: dv(3) }, загрузка_кадра_мс: +(window.__perfG.reduce((a, x) => a + x, 0) / window.__perfG.length).toFixed(1), загрузок: window.__perfG.length, холст: [document.querySelector('.view canvas').width, document.querySelector('.view canvas').height] };
  });
  console.log(`${sp}×`, JSON.stringify(r));
}
await browser.close();
