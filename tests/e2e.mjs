// Автопроверка приложения в Chromium: настройки → медиа → монтаж → кадр и цвет → экспорт. Запуск: bash tests/run.sh
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "fs";
const shots = process.env.SHOTS || "tests/shots";
fs.mkdirSync(shots, { recursive: true });
const fake = fs.readFileSync(new URL("./fake.js", import.meta.url), "utf8");
const URL0 = "http://127.0.0.1:8765/app/";
let failed = 0;
const ok = (c, name) => { console.log((c ? "  ✓ " : "  ✗ ") + name); if (!c) failed++; };
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

async function run(label, viewport, scale) {
  console.log(label);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: true, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(fake);
  await page.goto(URL0);
  const shot = async (n) => (await page.waitForTimeout(350), page.screenshot({ path: `${shots}/${label}-${n}.png` }));
  const ed = (f) => page.evaluate(f);
  await page.waitForSelector(".home");
  ok(await page.locator(".setup").isVisible(), "главный экран зовёт подключить MEGA и GitHub");
  await shot("1-home");

  // настройки
  await page.click(".setup");
  await page.fill('input[type=email]', "me@example.com"); await page.fill('input[placeholder="Пароль MEGA"]', "не тот");
  await page.click("text=Войти");
  await page.waitForSelector(".error:visible");
  ok((await page.locator(".error:visible").first().textContent()).includes("Неверная"), "неверный пароль MEGA — понятная ошибка");
  await shot("2-settings");
  await page.fill('input[placeholder="Пароль MEGA"]', "верный"); await page.click("text=Войти");
  await page.waitForSelector("text=Вход выполнен");
  ok(!JSON.stringify(await page.evaluate(() => localStorage.getItem("studio.mega"))).includes("верный"), "пароль MEGA не сохраняется");
  await page.click("summary");
  await page.fill('input[placeholder^="Токен"]', "bad"); await page.click("text=Сохранить и проверить");
  await page.waitForSelector(".error:visible");
  ok(await page.evaluate(() => localStorage.getItem("studio.gh")) === null, "неверный токен не сохраняется");
  await page.fill('input[placeholder^="Токен"]', "github_pat_ok"); await page.click("text=Сохранить и проверить");
  await page.waitForSelector("text=Токен сохранён");
  await shot("3-settings-ok");
  await page.click('.sheet [aria-label="Закрыть"]');
  await page.waitForTimeout(300);
  ok(!(await page.locator(".setup").count()), "после подключения подсказка исчезла");

  // новый проект и медиа
  await page.click(".card.new");
  await page.waitForSelector(".empty");
  await shot("4-empty");
  await page.click(".empty .btn");
  await page.waitForSelector(".lib .item >> text=Съёмка 1.mov");
  await shot("5-library");
  await page.click(".lib .item >> text=Съёмка 2.mov");            // нет копии → подготовка сборщиком
  await page.click(".lib .item >> text=Съёмка 1.mov");            // копия в MEGA → скачать
  await page.waitForSelector(".lib .badge.on");
  await page.click(".lib-foot .btn");
  await page.waitForSelector(".clip");
  await page.waitForFunction(() => window.__ed && Math.abs(window.__ed.total() - 8) < 0.2);
  ok(true, "видео из MEGA добавлено на дорожку (8 с)");
  await page.waitForFunction(() => document.querySelector(".clip canvas").getContext("2d").getImageData(30, 30, 1, 1).data[3] > 0, null, { timeout: 20000 });
  ok(true, "на дорожке есть миниатюры");
  const px = () => page.evaluate(() => { const c = document.querySelector(".view canvas"), g = c.getContext("webgl"), b = new Uint8Array(4); g.readPixels(c.width >> 1, c.height >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, b); return [...b]; });
  await page.waitForFunction(() => { const c = document.querySelector(".view canvas"), g = c.getContext("webgl"), b = new Uint8Array(4); g.readPixels(c.width >> 1, c.height >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, b); return b[0] + b[1] + b[2] > 30; });
  ok(true, "превью показывает кадр");

  // резка, удаление, отмена
  await ed(() => window.__ed.seek(3));
  await page.click('[data-tool=split]');
  ok(await page.locator(".clip").count() === 2, "разрезать: два клипа");
  await ed(() => window.__ed.seek(5.5)); await page.click('[data-tool=split]');
  ok(await page.locator(".clip").count() === 3, "ещё разрез: три клипа");
  await page.locator(".clip").nth(1).click();
  await page.click('[data-tool=delete]');
  ok(await page.locator(".clip").count() === 2 && Math.abs(await ed(() => window.__ed.total()) - 5.5) < 0.05, "удалить середину: 5,5 с");
  await page.click('[aria-label="Отменить"]');
  ok(await page.locator(".clip").count() === 3, "отменить: снова три клипа");
  await page.click('[aria-label="Вернуть"]');
  ok(await page.locator(".clip").count() === 2, "вернуть: два клипа");

  // обрезка края
  await page.evaluate(() => document.querySelector(".tl-scroll").scrollTo(0, 0));
  await page.locator(".clip").nth(0).click();
  const g = await page.locator(".clip.sel .grip.r").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 20); await page.mouse.down(); await page.mouse.move(g.x + g.width / 2 - 60, g.y + 20, { steps: 5 }); await page.mouse.up();
  const first = await ed(() => window.__ed.P.clips[0].out - window.__ed.P.clips[0].in);
  ok(first < 2.95 && first > 0.2, `обрезка правого края: клип стал ${first.toFixed(2)} с`);

  // перестановка долгим нажатием
  const ids = await ed(() => window.__ed.P.clips.map((c) => c.id));
  const a = await page.locator(".clip").nth(0).boundingBox(), b = await page.locator(".clip").nth(1).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 20); await page.mouse.down(); await page.waitForTimeout(500);
  await page.mouse.move(b.x + b.width - 5, a.y + 20, { steps: 8 }); await shot("6-reorder"); await page.mouse.up();
  const ids2 = await ed(() => window.__ed.P.clips.map((c) => c.id));
  ok(ids2[0] === ids[1] && ids2[1] === ids[0], "перестановка клипов долгим нажатием");

  // кадр и цвет
  await ed(() => window.__ed.seek(1));
  await page.waitForTimeout(300);
  const p0 = await px();
  await page.click('[data-tool=color]');
  await page.locator('input[aria-label="Экспозиция"]').fill("0.8");
  await page.waitForTimeout(100);
  const p1 = await px();
  ok(p1[0] + p1[1] + p1[2] > p0[0] + p0[1] + p0[2] + 8, `цвет: экспозиция делает кадр светлее (${p0.slice(0, 3)} → ${p1.slice(0, 3)})`);
  await shot("7-color");
  await page.click(".panel .seg >> text=Оттенки"); await page.waitForSelector(".bands");
  await page.click(".panel .seg >> text=Детали");
  await page.locator('input[aria-label="Чёткость"]').fill("0.6"); await page.locator('input[aria-label="Резкость"]').fill("0.5");
  await page.click('[data-tool=frame]');
  await page.locator('input[aria-label="Размер"]').fill("1.6"); await page.locator('input[aria-label="Поворот"]').fill("12");
  await page.waitForTimeout(100);
  ok((await ed(() => window.__ed.P.clips[0].frame?.scale)) === 1.6, "кадр: размер и поворот записаны в клип");
  await shot("8-frame");
  await page.click("text=Показать целиком"); await page.waitForTimeout(100);
  await shot("9-fit");
  await page.click(".panel-head >> text=Готово");

  // субтитры
  await page.click('[data-tool=subs]');
  await page.click("text=Создать субтитры");
  await page.waitForFunction(() => window.__ed.lines.length > 0);
  const nl = await ed(() => window.__ed.lines.length);
  ok(nl >= 2 && await page.locator(".sub").count() === nl, `авто-субтитры: ${nl} строк, на дорожке столько же`);
  const inked = () => page.evaluate(() => { const c = document.querySelector("canvas.over"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n; });
  await ed(() => window.__ed.seek(window.__ed.lines[0].words[0].start + 0.2)); await page.waitForTimeout(400);
  ok(await inked() > 300, "субтитры видны на превью");
  await shot("7a-subs");
  await page.click('.presets [aria-label="Плашка"]'); await page.waitForTimeout(300);
  ok(await ed(() => window.__ed.P.subs.style.hl) === "box", "шаблон субтитров применяется одним нажатием");
  await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 8000 });
  // текст: правка, ключевое слово, разделить
  await page.click(".panel .tabs >> text=Текст");
  const le = page.locator(".line-edit").first();
  await le.click(); await le.fill("Новый текст строки"); await page.locator(".panel-head b").click();
  await page.waitForTimeout(200);
  ok((await ed(() => window.__ed.lines[0].raw)).startsWith("Новый текст") && !(await page.locator(".sheet").count()), "текст правится прямо в списке, без отдельного окна");
  await page.click('[aria-label="Отменить"]');
  ok(!(await ed(() => window.__ed.lines[0].raw)).startsWith("Новый"), "правка текста отменяется");
  const n0 = await ed(() => window.__ed.lines.length), raw0 = await ed(() => window.__ed.lines[0].raw), raw1 = await ed(() => window.__ed.lines[1].raw);
  await page.locator(".line-edit").first().click();
  await page.evaluate((n) => { const el = document.querySelector(".line-edit"); el.setSelectionRange(n, n); }, raw0.indexOf(" "));
  await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  ok(await ed(() => window.__ed.lines.length) === n0 + 1 && await ed(() => window.__ed.lines[2].raw) === raw1, "Enter: слова после курсора стали отдельным субтитром, нижние сдвинулись");
  ok(await page.evaluate(() => document.activeElement?.dataset?.i) === "1", "курсор перешёл в новую строку");
  await page.keyboard.press("Backspace"); await page.waitForTimeout(250);
  ok(await ed(() => window.__ed.lines.length) === n0 && await ed(() => window.__ed.lines[0].raw) === raw0, "стирание в начале строки склеивает её с верхней");
  await page.locator(".panel-head b").click();
  await page.locator('.lrow [aria-label^="Ещё"]').first().click();
  await page.locator(".sheet .wchip").first().click();
  ok(await ed(() => window.__ed.lines[0].words[0].em) === true, "слово отмечается ключевым");
  await shot("7b-line");
  await page.click(".sheet >> text=Готово");
  await page.click('[aria-label="Отменить"]');
  // шрифт из MEGA
  await page.click(".panel .tabs >> text=Шрифт");
  await page.click(".fonts >> text=Мой шрифт");
  await page.waitForFunction(() => window.__ed.P.subs.style.font === "Мой шрифт");
  ok(await page.evaluate(() => document.fonts.check('20px "Мой шрифт"')), "свой шрифт из MEGA «Для монтажа ПАК» скачан и подключён");
  ok(await page.locator(".fonts >> text=Второй").count() === 1, "шрифты находятся и во вложенных папках");
  await page.locator('input[aria-label="Высота букв"]').fill("2"); await page.locator('input[aria-label="Ширина букв"]').fill("0.7");
  await page.locator('input[aria-label="Между словами"]').fill("0.4"); await page.locator('input[aria-label="Между строками"]').fill("1.6");
  ok(await ed(() => { const s = window.__ed.P.subs.style; return s.sy === 2 && s.sx === 0.7 && s.ws === 0.4 && s.lh === 1.6; }), "высота и ширина букв, расстояния между словами и строками настраиваются");
  await ed(() => window.__ed.seek(window.__ed.lines[0].words[0].start + 0.5)); await page.waitForTimeout(300);
  await shot("7c-font");
  // цвет: палитра
  await page.click(".panel .tabs >> text=Цвет");
  await page.fill(".cp-hex", "#12ab34"); await page.locator(".cp-hex").blur();
  ok(await ed(() => window.__ed.P.subs.style.color) === "#12ab34", "цвет текста задаётся кодом");
  await page.locator(".cp-sq").scrollIntoViewIfNeeded();
  const sq = await page.locator(".cp-sq").boundingBox();
  await page.mouse.click(sq.x + sq.width * 0.9, sq.y + sq.height * 0.8);
  const col = await ed(() => window.__ed.P.subs.style.color);
  ok(col !== "#12ab34" && /^#[0-9a-f]{6}$/.test(col), `цвет выбирается на палитре (${col})`);
  await page.locator(".cp-hue").fill("200"); await page.waitForTimeout(100);
  await shot("7d-color");
  await page.click(".panel .seg >> text=Плашка"); await page.locator('input[aria-label="Плотность фона"]').fill("0.7");
  await page.click(".panel .seg >> text=Свечение"); await page.locator('input[aria-label="Сила свечения"]').fill("0.5");
  // анимация
  await page.click(".panel .tabs >> text=Анимация");
  await page.click(".tiles >> text=Шторка вверх");
  ok(await ed(() => window.__ed.P.subs.style.in) === "wipeUp", "анимация появления выбирается");
  await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 8000 });
  await page.click(".panel .seg >> text=Слова"); await page.click(".tiles >> text=Заливка");
  await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 8000 });
  await shot("7e-anim");
  // перетаскивание пальцем по видео
  const cb = await page.locator(".view canvas").first().boundingBox(), y0 = await ed(() => window.__ed.P.subs.style.y ?? 0.72);
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * 0.7); await page.mouse.down(); await page.mouse.move(cb.x + cb.width / 2 + 1, cb.y + cb.height * 0.5, { steps: 4 }); await page.mouse.up();
  const y1 = await ed(() => window.__ed.P.subs.style.y);
  ok(y1 < y0 - 0.1 && await ed(() => window.__ed.P.subs.style.x) === 0.5, `субтитры двигаются пальцем по видео (${y0.toFixed(2)} → ${y1.toFixed(2)}), по центру «прилипают»`);
  await ed(() => window.__ed.seek(window.__ed.lines[0].words[0].start + 0.3)); await page.waitForTimeout(300);
  await shot("7f-moved");
  // только выбранные субтитры и одно слово
  await page.evaluate(() => document.querySelector(".tl-scroll").scrollTo(0, 0)); await page.waitForTimeout(200);
  const gFont = await ed(() => window.__ed.P.subs.style.font);
  await page.locator(".sub").nth(0).click();
  ok(await ed(() => window.__ed.subApi.scope()) === "lines" && await page.locator(".sub.sel").count() === 1, "нажатие на субтитр выбирает его, галочка «все сразу» снимается");
  await page.locator(".sub").nth(2).click({ modifiers: ["Shift"] });
  ok(await page.locator(".sub.sel").count() === 3, "Shift + нажатие выбирает несколько подряд");
  await page.click(".panel .tabs >> text=Шрифт"); await page.click(".fonts >> text=Oswald");
  await page.waitForFunction(() => window.__ed.lines[0].style?.font === "Oswald");
  ok(await ed(() => { const L = window.__ed.lines; return L[1].style?.font === "Oswald" && L[2].style?.font === "Oswald" && window.__ed.P.subs.style.font; }) === gFont, "шрифт сменился только у выбранных строк, остальные и общий стиль не тронуты");
  await ed(() => window.__ed.subApi.clearSel());
  const wi = await ed(() => window.__ed.lines.findIndex((l) => l.words.length > 1));
  await page.locator(".sub").nth(wi).click();
  await page.click(".scope >> text=Изменить только одно слово");
  await page.locator(".scope .wchip").first().click();
  ok(await ed(() => window.__ed.subApi.scope()) === "word", "можно выбрать одно слово");
  await page.click(".panel .tabs >> text=Цвет");
  await page.locator(".cp-hex").scrollIntoViewIfNeeded(); await page.fill(".cp-hex", "#ff00aa"); await page.locator(".cp-hex").blur();
  ok(await page.evaluate((wi) => { const l = window.__ed.lines[wi]; return l.words[0].style?.color === "#ff00aa" && !l.words[1]?.style && l.style?.color !== "#ff00aa" && window.__ed.P.subs.style.color !== "#ff00aa"; }, wi), "цвет сменился только у одного слова");
  await page.evaluate((wi) => window.__ed.seek(window.__ed.lines[wi].words[0].start + 0.2), wi); await page.waitForTimeout(300);
  await shot("7g-word");
  // слои: субтитр уходит на второй этаж и двигается по времени
  await ed(() => window.__ed.subApi.setWord(null));
  await page.click('.layers [aria-label="Слой 2"]');
  ok(await page.evaluate((wi) => window.__ed.lines[wi].layer === 1, wi) && await page.locator(".tl-subs .srow").count() === 2, "субтитр отправляется на второй слой — на таймлайне появляется второй этаж");
  const s0 = await page.evaluate((wi) => window.__ed.lines[wi].start, wi);
  const cb2 = await page.locator(".sub.one").boundingBox();
  await page.mouse.move(cb2.x + cb2.width / 2, cb2.y + 10); await page.mouse.down(); await page.mouse.move(cb2.x + cb2.width / 2 + 40, cb2.y + 10, { steps: 4 }); await page.mouse.up();
  const s1 = await page.evaluate((wi) => window.__ed.lines[wi].start, wi);
  ok(s1 > s0 + 0.05, `субтитр на слое двигается по времени (${s0.toFixed(2)} → ${s1.toFixed(2)} с)`);
  const gr2 = await page.locator(".sub.one .g.r").boundingBox(), e0 = await page.evaluate((wi) => window.__ed.lines[wi].end, wi);
  await page.mouse.move(gr2.x + 4, gr2.y + 10); await page.mouse.down(); await page.mouse.move(gr2.x + 44, gr2.y + 10, { steps: 4 }); await page.mouse.up();
  ok(await page.evaluate((wi) => window.__ed.lines[wi].end, wi) > e0 + 0.05, "и удлиняется за край");
  await page.evaluate((wi) => window.__ed.seek(window.__ed.lines[wi].start + 0.3), wi); await page.waitForTimeout(300);
  await shot("7g2-layers");
  await page.locator(".scope .check").click();
  ok(await ed(() => window.__ed.subApi.scope()) === "all", "галочка возвращает режим «все субтитры»");
  ok(await page.locator(".sub i.ain").count() > 0, "на плашках субтитров видна длительность анимации");
  // облако — отдельный объект на своей дорожке
  await page.click('[data-tool=cloud]'); await page.click("text=Добавить облако здесь");
  ok(await ed(() => window.__ed.P.clouds.length) === 1 && await page.locator(".cl.sel").count() === 1, "облако добавляется и появляется на своей дорожке");
  await page.locator('input[aria-label="Плотность"]').fill("0.8"); await page.locator('input[aria-label="Ширина"]').fill("1.1");
  const c0 = await ed(() => ({ ...window.__ed.P.clouds[0] }));
  const gr = await page.locator(".cl.sel .g.r").boundingBox();
  await page.mouse.move(gr.x + 5, gr.y + 10); await page.mouse.down(); await page.mouse.move(gr.x - 25, gr.y + 10, { steps: 4 }); await page.mouse.up();
  const c1 = await ed(() => ({ ...window.__ed.P.clouds[0] }));
  ok(c1.end < c0.end - 0.1 && c1.start === c0.start && c1.a === 0.8, `облако укорачивается за край (${(c0.end - c0.start).toFixed(1)} → ${(c1.end - c1.start).toFixed(1)} с)`);
  const vb = await page.locator(".view canvas").first().boundingBox();
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height * 0.7); await page.mouse.down(); await page.mouse.move(vb.x + vb.width / 2 + 1, vb.y + vb.height * 0.3, { steps: 4 }); await page.mouse.up();
  ok(await ed(() => window.__ed.P.clouds[0].y) < c1.y - 0.2, "облако двигается пальцем по видео");
  await ed(() => window.__ed.seek(window.__ed.P.clouds[0].start + 0.5)); await page.waitForTimeout(300);
  await shot("7h-cloud");
  await page.click(".guide-btn"); await page.waitForTimeout(200);
  ok(await page.locator(".guides").isVisible(), "рамка Instagram включается одной кнопкой");
  await shot("7i-guides");
  await page.click(".guide-btn");
  ok(!(await page.locator(".guides").isVisible()), "и выключается той же кнопкой");
  await page.click(".panel-head >> text=Готово");

  // воспроизведение через склейку
  await ed(() => window.__ed.seek(0));
  await page.click(".play"); await page.waitForTimeout(1500);
  const tp = await ed(() => window.__ed.t);
  ok(tp > 0.8 && tp < 2.5, `воспроизведение идёт (за 1,5 с ушло на ${tp.toFixed(2)} с)`);
  await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 15000 });
  ok(Math.abs(await ed(() => window.__ed.t - window.__ed.total())) < 0.1, "доиграло до конца через склейки и остановилось");
  await ed(() => window.__ed.seek(2)); await page.waitForTimeout(200);
  await shot("10-editor");

  // подготовка второго файла закончилась?
  await page.click('[data-tool=media]');
  await page.waitForSelector(".lib .item >> text=Съёмка 2.mov");
  await page.waitForFunction(() => [...document.querySelectorAll(".lib .item")].some((i) => i.textContent.includes("Съёмка 2") && i.textContent.includes("на устройстве")), null, { timeout: 60000 });
  ok(true, "файл без копии: сборщик подготовил, копия скачалась");
  const disp = await page.evaluate(() => window.__fakeLog.find((l) => l.startsWith("dispatch prepare")));
  ok(/"file":"#[0-9a-f]{16}"/.test(disp) && !disp.includes("Съёмка"), "сборщику ушёл хеш имени, а не имя");
  await page.click('.sheet [aria-label="Закрыть"]');

  // экспорт
  await page.click(".bar .btn.primary");
  await page.waitForSelector(".spec");
  await shot("11-export");
  await page.click("text=Собрать видео");
  await page.waitForSelector(".step.now");
  await shot("12-export-progress");
  await page.waitForSelector("text=Сохранить на устройство", { timeout: 60000 });
  await shot("13-export-done");
  const job = await page.evaluate(async () => { const k = Object.keys(window.__fakeFiles).find((x) => x.includes("/jobs/")); return JSON.parse(await window.__fakeFiles[k].text()); });
  const d2 = await page.evaluate(() => window.__fakeLog.find((l) => l.startsWith("dispatch export")));
  ok(job.output.w === 2160 && job.output.h === 3840 && job.timeline.length === 2 && job.grade.exposure === 0.8 && Object.values(job.clips)[0].file.startsWith("#"), "проект для сборщика лёг в MEGA: 4K, клипы, цвет, имена хешем");
  ok(job.subs && job.subs.lines.length >= 2 && job.subs.lines[0].words[0].text && job.subs.style.font, "субтитры ушли сборщику вместе с проектом");
  ok(job.subs.fonts?.[0]?.path === "Для монтажа ПАК/Шрифты/Мой шрифт.ttf", "сборщику передан путь к своему шрифту в MEGA");
  ok(job.subs.lines.some((l) => l.style?.font === "Oswald") && job.subs.lines.some((l) => l.words.some((w) => w.style?.color === "#ff00aa")) && job.subs.clouds?.length === 1 && job.subs.clouds[0].a === 0.8, "свои настройки строк и слов и облако ушли сборщику");
  ok(job.subs.lines.some((l) => l.style?.layer === 1), "слой субтитра ушёл сборщику");
  ok(!d2.includes(job.name) && !d2.includes("clips"), "в GitHub ушёл только номер задания");
  await page.click('.sheet [aria-label="Закрыть"]');

  // назад и снова открыть — проект сохранился
  await page.click(".bar .link");
  await page.waitForSelector(".card:not(.new)");
  await shot("14-home-projects");
  await page.reload(); await page.waitForSelector(".card:not(.new)");
  await page.click(".card:not(.new)");
  await page.waitForFunction(() => window.__ed && window.__ed.P.clips.length === 2);
  await page.waitForFunction(() => { const c = document.querySelector(".view canvas"), g = c.getContext("webgl"), b = new Uint8Array(4); g.readPixels(c.width >> 1, c.height >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, b); return b[0] + b[1] + b[2] > 30; });
  ok(true, "после перезапуска проект и превью на месте");
  ok(errors.length === 0, "нет ошибок в консоли" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
  await ctx.close();
}
{
  const page = await browser.newPage(); await page.goto(URL0);
  ok(await page.evaluate(async () => typeof (await import("./vendor/mega.mjs")).Storage === "function"), "библиотека MEGA загружается в браузере");
  await page.close();
}
await run("ipad", { width: 1180, height: 820 }, 2);
await run("iphone", { width: 390, height: 844 }, 2);
await run("ipad-portrait", { width: 820, height: 1180 }, 1);
await browser.close();
console.log(failed ? `НЕ ПРОШЛО: ${failed}` : "всё прошло");
process.exit(failed ? 1 : 0);
