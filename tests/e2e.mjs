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
  // нажать кнопку нижней строки; если её нет в видимой строке (выбран клип) — сперва «Назад»
  const tool = async (id) => {
    const vis = page.locator(`nav.tools:not([hidden]) [data-tool=${id}]`);
    if (!(await vis.count())) await page.click(await page.locator("nav.clipbar[hidden]").count() ? "nav.tools [data-tool=clip]" : "nav.clipbar [data-tool=back]");
    await page.click(`nav.tools:not([hidden]) [data-tool=${id}]`);
  };
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
  await tool("color");
  if (await page.locator(".cscope").count()) { await page.click(".cscope >> text=Весь ролик"); await ed(() => window.__ed.seek(1)); await page.waitForTimeout(300); }   // из строки клипа «Цвет» открывается для клипа (и встаёт на него)
  await page.waitForSelector(".looks button img[src^='data:']", { timeout: 8000 });
  ok(await page.locator(".looks button").count() >= 12, "пресеты цвета с превью на своём кадре");
  await page.click(".looks button[data-look=cinema]"); await page.waitForTimeout(150);
  ok(await ed(() => window.__ed.P.look?.id === "cinema" && window.__ed.P.grade.contrast > 0), "пресет «Кино» применяется одним нажатием");
  await page.locator(".looks button[data-look=cinema] .star").click();
  ok(await page.evaluate(() => document.querySelector(".looks button")?.dataset.look) === "cinema", "избранный пресет встаёт первым");
  await shot("7-looks");
  await page.click(".panel-head >> text=Сбросить");
  await page.click(".panel .seg >> text=Свет");
  await page.locator('input[aria-label="Экспозиция"]').fill("0.8");
  await page.waitForTimeout(100);
  const p1 = await px();
  ok(p1[0] + p1[1] + p1[2] > p0[0] + p0[1] + p0[2] + 8, `цвет: экспозиция делает кадр светлее (${p0.slice(0, 3)} → ${p1.slice(0, 3)})`);
  await shot("7-color");
  // «Мои»: сохранить настройку цвета под своим именем и применить одним нажатием
  await page.click(".mine-add"); await page.fill(".sheet input.field", "Мой тёплый"); await page.click(".sheet >> text=Готово"); await page.waitForTimeout(300);
  const exp0 = await ed(() => window.__ed.P.grade.exposure);
  await page.click(".panel-head >> text=Сбросить"); await page.waitForTimeout(100);
  ok(!(await ed(() => window.__ed.P.grade.exposure)), "цвет сброшен");
  await page.click('.mine-c[data-my="Мой тёплый"]'); await page.waitForTimeout(150);
  ok(await ed(() => window.__ed.P.grade.exposure) === exp0 && await page.evaluate(() => JSON.parse(localStorage.getItem("studio.my")).color.length === 1), "«Мои»: сохранённый цвет применяется одним нажатием (есть во всех видео)");
  await shot("7m-mine");
  // свой цвет у клипа: «Этот клип» — правка только у него, у ролика цвет прежний
  const gAll = await ed(() => JSON.stringify(window.__ed.P.grade));
  await page.click(".cscope >> text=Этот клип");
  await page.click(".panel .seg.scroll >> text=Свет"); await page.locator('input[aria-label="Контраст"]').fill("-0.7"); await page.waitForTimeout(150);
  ok(await ed(() => window.__ed.P.clips.some((c) => c.grade && c.grade.contrast === -0.7)) && await ed(() => JSON.stringify(window.__ed.P.grade)) === gAll, "свой цвет у клипа: меняется только он, цвет ролика прежний");
  ok(await page.locator(".clip .clip-cc").count() === 1 && await ed(() => window.__ed.job().timeline.some((x) => x.grade && x.grade.contrast === -0.7)), "значок ◐ на клипе, сборщику уходит цвет клипа");
  await shot("7n-clipcolor");
  await page.click(".panel-head >> text=Сбросить");
  ok(await ed(() => !window.__ed.P.clips.some((c) => c.grade)), "«Сбросить» возвращает клипу цвет ролика");
  await page.click(".cscope >> text=Весь ролик");
  if (await page.locator("nav.clipbar:not([hidden])").count()) await page.click("nav.clipbar [data-tool=back]");
  await ed(() => window.__ed.seek(1));
  await page.click(".panel .seg >> text=Оттенки"); await page.waitForSelector(".bands");
  await page.click(".panel .seg >> text=Детали");
  await page.locator('input[aria-label="Чёткость"]').fill("0.6"); await page.locator('input[aria-label="Резкость"]').fill("0.5");
  await tool("clip"); await tool("frame");
  await page.locator('input[aria-label="Размер"]').fill("1.6"); await page.locator('input[aria-label="Поворот"]').fill("12");
  await page.waitForTimeout(100);
  ok((await ed(() => window.__ed.P.clips[0].frame?.scale)) === 1.6, "кадр: размер и поворот записаны в клип");
  await shot("8-frame");
  await page.click("text=Показать целиком"); await page.waitForTimeout(100);
  await shot("9-fit");
  // ключевые кадры: ключ в начале, в другом месте другой размер → второй ключ, между ними — плавно
  await ed(() => window.__ed.seek(0.3)); await page.waitForTimeout(150);
  await page.click('.keys [data-key="add"]');
  await ed(() => window.__ed.seek(2.1)); await page.waitForTimeout(150);
  await page.locator('input[aria-label="Размер"]').fill("2.4"); await page.waitForTimeout(100);
  const kk = await ed(() => { const c = window.__ed.P.clips[0]; return { n: c.keys?.length, mid: window.__ed.frameAt(c, 1.2).scale, a: c.keys?.[0]?.scale, b: c.keys?.[1]?.scale }; });
  ok(kk.n === 2 && kk.b === 2.4 && kk.mid > kk.a && kk.mid < kk.b, `ключевые кадры: 2 ключа, между ними размер плавно растёт (${kk.a} → ${kk.mid?.toFixed(2)} → ${kk.b})`);
  ok(await page.locator(".clip").first().locator(".kf").count() === 2 && await ed(() => window.__ed.job().timeline[0].keys?.length === 2), "ключи видны ◆ на клипе и уходят сборщику");
  await shot("9k-keys");
  await page.click('.keys [aria-label="Предыдущий ключ"]'); await page.waitForTimeout(100);
  ok(Math.abs(await ed(() => window.__ed.t) - 0.3) < 0.05, "◀ — к предыдущему ключу" + " " + JSON.stringify(await ed(() => ({ t: window.__ed.t, keys: window.__ed.P.clips[0].keys }))));
  await page.click('.keys [data-key="del"]');
  ok(await ed(() => window.__ed.P.clips[0].keys?.length) === 1, "«Убрать ключ»");
  await ed(() => { delete window.__ed.P.clips[0].keys; window.__ed.seek(1); });
  // ключ кнопками над таймлайном: ◆+ ставит, ◆− убирает (на месте линии)
  await page.click('[data-tool="key-add"]'); await page.waitForTimeout(100);
  ok(await ed(() => window.__ed.P.clips.some((c) => c.keys?.length === 1)) && await page.locator('[data-tool="key-del"]').isEnabled(), "◆+ над таймлайном ставит ключ, ◆− становится доступна");
  await shot("9l-keybtns");
  await page.click('[data-tool="key-del"]'); await page.waitForTimeout(100);
  ok(await ed(() => !window.__ed.P.clips.some((c) => c.keys)) && await page.locator('[data-tool="key-del"]').isDisabled(), "◆− убирает ключ");
  await page.click(".panel-head >> text=Готово");
  // маска
  await tool("mask"); await page.click(".tiles >> text=Круг");
  await page.locator('input[aria-label="Растушёвка края"]').fill("0.2");
  const corner = () => page.evaluate(() => { const c = document.querySelector("canvas.over"); return [...c.getContext("2d").getImageData(3, 3, 1, 1).data, ...c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data]; });
  const mk = await corner();
  ok(mk[3] > 240 && mk[7] < 20 && await ed(() => window.__ed.P.clips[0].mask?.shape) === "ellipse", "маска «Круг»: угол кадра закрыт, центр виден");
  await shot("9a-mask");
  await page.click(".panel-head >> text=Готово");
  // скорость клипа
  const T0 = await ed(() => window.__ed.total()), L0 = await ed(() => { const c = window.__ed.P.clips[0]; return c.out - c.in; });
  await ed(() => window.__ed.seek(0.2));
  await tool("speed"); await page.click(".panel .tiles >> text=2×");
  ok(Math.abs(await ed(() => window.__ed.total()) - (T0 - L0 / 2)) < 0.02 && await ed(() => window.__ed.P.clips[0].speed) === 2, "скорость 2×: клип стал вдвое короче на таймлайне");
  await shot("9b-speed");
  await page.click(".panel .seg >> text=Кривая"); await page.click(".tiles.curves >> text=Герой");
  const Tc = await ed(() => window.__ed.total());
  ok(await ed(() => Array.isArray(window.__ed.P.clips[0].curve)) && Math.abs(Tc - T0) > 0.1, `кривая скорости «Герой»: длина ролика ${T0.toFixed(2)} → ${Tc.toFixed(2)} с`);
  await page.locator("canvas.curve").scrollIntoViewIfNeeded(); const cvb = await page.locator("canvas.curve").boundingBox();
  const p2 = await ed(() => window.__ed.P.clips[0].curve[2]);
  await page.mouse.move(cvb.x + cvb.width * p2[0], cvb.y + cvb.height * 0.75); await page.mouse.down(); await page.mouse.move(cvb.x + cvb.width * p2[0], cvb.y + cvb.height * 0.15, { steps: 5 }); await page.mouse.up();
  ok(await ed(() => window.__ed.P.clips[0].curve[2][1]) > p2[1] * 3, "точку кривой можно тянуть пальцем");
  // секунды меняются, пока палец ещё на точке; видео встаёт на кадр под точкой
  const p3 = await ed(() => window.__ed.P.clips[0].curve[3]), info0 = await page.textContent(".speed-info");
  const cvb2 = await page.locator("canvas.curve").boundingBox(), yOf = (v) => (160 - 8 - Math.log(v / 0.1) / Math.log(100) * (160 - 8 - 18)) / 160;
  await page.mouse.move(cvb2.x + cvb2.width * p3[0], cvb2.y + cvb2.height * yOf(p3[1])); await page.mouse.down();
  await page.mouse.move(cvb2.x + cvb2.width * (p3[0] - 0.05), cvb2.y + cvb2.height * 0.15, { steps: 5 });
  const info1 = await page.textContent(".speed-info"), tAt = await ed(() => window.__ed.t);
  const want = await ed(() => { const c = window.__ed.P.clips[0]; return c.curve[3][0]; });
  await page.mouse.up();
  ok(info1 !== info0, `секунды видны сразу, пока тянете точку (${info0} → ${info1})`);
  ok(Math.abs(await ed(() => { const c = window.__ed.P.clips[0]; return (window.__ed.srcAt(c, window.__ed.t) - c.in) / (c.out - c.in); }) - want) < 0.03, `видео показывает кадр под точкой (t = ${tAt.toFixed(2)})`);
  // добавить и убрать точку
  const nP = await ed(() => window.__ed.P.clips[0].curve.length);
  await page.mouse.click(cvb2.x + cvb2.width * 0.12, cvb2.y + cvb2.height * 0.97);   // листать по пустому месту
  await page.click(".curve-box >> text=Точка");
  ok(await ed(() => window.__ed.P.clips[0].curve.length) === nP + 1, "«+ Точка» ставит новую точку там, где белая линия");
  await page.click(".curve-box >> text=Убрать точку");
  ok(await ed(() => window.__ed.P.clips[0].curve.length) === nP, "«Убрать точку»");
  ok(await page.locator(".tiles.curves button.on[data-curve=custom]").count() === 1, "изменённая кривая — «Своя»");
  await shot("9c-curve2");
  await shot("9c-curve");
  await page.click(".panel .seg >> text=Обычная");
  await page.click(".panel .tiles >> text=1×");
  ok(Math.abs(await ed(() => window.__ed.total()) - T0) < 0.02 && !(await ed(() => window.__ed.P.clips[0].speed)), "скорость возвращается к 1×");
  // воспроизведение с ускорением и кривой: время на таймлайне не встаёт
  for (const [name, fn] of [["4×", (c) => { c.speed = 4; }], ["кривая «Вспышка»", (c) => { delete c.speed; c.curve = [[0, 5], [0.3, 4], [0.5, 1], [1, 1]]; }]]) {
    await ed(`(${fn})(window.__ed.P.clips[0]); window.__ed.seek(0.01)`);
    await page.click('[aria-label="Пуск"]'); await page.waitForTimeout(700);
    const tp = await ed(() => window.__ed.t); await page.click('[aria-label="Пуск"]').catch(() => {});
    await ed(() => { window.__ed.pause?.(); });
    ok(tp > 0.35, `воспроизведение ${name}: время идёт (${tp.toFixed(2)} с за 0,7 с)`);
  }
  await ed(() => { const c = window.__ed.P.clips[0]; delete c.speed; delete c.curve; window.__ed.seek(0.2); });
  await page.click(".panel-head >> text=Готово");
  // нажали на клип — внизу его действия
  await page.evaluate(() => document.querySelector(".tl-ruler").click());
  await page.locator(".tl-track .clip").nth(1).click();
  ok(await page.locator("nav.clipbar:not([hidden])").count() === 1 && !!(await ed(() => window.__ed.sel)), "нажатие на клип открывает строку его действий");
  await shot("9d-clipbar");
  const nC = await ed(() => window.__ed.P.clips.length);
  await page.click("nav.clipbar [data-tool=c-dup]");
  ok(await ed(() => window.__ed.P.clips.length) === nC + 1, "«Копия» клипа");
  await page.click('[aria-label="Отменить"]');
  ok(!(await page.locator("nav.clipbar [data-tool=c-split], nav.clipbar [data-tool=c-delete]").count()), "в строке клипа нет повторов «Разрезать» и «Удалить» (они у ▶)");
  // громкость клипа: прямо в строке клипа
  if (!(await page.locator("nav.clipbar:not([hidden])").count())) await page.locator(".tl-track .clip").nth(1).click();
  await page.click("nav.clipbar [data-tool=cvol]");
  await page.locator('.panel input[aria-label="Громкость"]').fill("0.5");
  const cv = await ed(() => { const c = window.__ed.P.clips.find((x) => x.id === window.__ed.sel), j = window.__ed.job(); return { v: c.volume, jv: j.timeline[window.__ed.P.clips.indexOf(c)].volume }; });
  ok(cv.v === 0.5 && cv.jv === 0.5, "«Громкость» клипа: 50 %, уходит сборщику");
  await page.click(".panel >> text=Без звука");
  ok(await ed(() => window.__ed.job().timeline.some((s) => s.mute)), "«Без звука» у клипа");
  await shot("9e-clipvol");
  await page.click('[aria-label="Отменить"]');   // «Без звука» отменяется стрелкой
  ok(await ed(() => !window.__ed.job().timeline.some((s) => s.mute)), "«Без звука» отменяется");
  await ed(() => { for (const c of window.__ed.P.clips) delete c.volume; });
  if (await page.locator("nav.clipbar:not([hidden])").count()) await page.click("nav.clipbar [data-tool=back]");
  ok(await page.locator("nav.clipbar[hidden]").count() === 1, "«Назад» возвращает общую строку");
  // переход на стыке клипов
  await page.evaluate(() => document.querySelector(".tl-ruler").click());   // снять выделение клипа
  await page.click(".trb");
  await page.click(".panel .tiles >> text=Затемнение"); await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 8000 });
  ok(await ed(() => window.__ed.P.clips[0].tr?.kind) === "black", "переход «Затемнение» на стыке клипов");
  await ed(() => window.__ed.seek(window.__ed.trList()[0].at)); await page.waitForTimeout(250);
  ok(await page.evaluate(() => { const c = document.querySelector("canvas.over"); return c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3]; }) > 240, "на стыке кадр закрыт переходом");
  await shot("9d-transition");
  // наплыв: клипы накладываются, ролик короче на длину наплыва; на стыке видны оба
  const Tn = await ed(() => window.__ed.total());
  await page.click(".panel .tiles >> text=Наплыв"); await page.waitForTimeout(300); await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 8000 });
  const Td = await ed(() => window.__ed.total()), ovd = await ed(() => window.__ed.ovl(0));
  ok(ovd > 0.2 && Math.abs(Tn - Td - ovd) < 0.01, `наплыв: ролик короче на ${ovd.toFixed(2)} с (${Tn.toFixed(2)} → ${Td.toFixed(2)})`);
  await ed(() => { const E = window.__ed; E.seek(E.startOf(1) + E.ovl(0) / 2); }); await page.waitForTimeout(600);
  ok(await ed(() => { const m = window.__ed.mixAt(window.__ed.t); return !!m && Math.abs(m.w - 0.5) < 0.05; }), "в середине наплыва смешиваются оба клипа поровну");
  await shot("9e-dissolve");
  ok(await ed(() => { const j = window.__ed.job(); return j.timeline[0].xfade > 0.2 && !(j.subs?.transitions || []).some((x) => x.kind === "dissolve"); }), "сборщику уходит наплыв (xfade) у клипа");
  await ed(() => window.__ed.seek(window.__ed.startOf(1) - 0.4)); await page.click('[aria-label="Пуск"]');
  const passed = await page.waitForFunction(() => window.__ed.t > window.__ed.startOf(1) + window.__ed.ovl(0) + 0.2, null, { timeout: 8000 }).then(() => true, () => false);
  ok(passed, "воспроизведение проходит наплыв и идёт дальше" + (passed ? "" : " " + JSON.stringify(await ed(() => ({ t: window.__ed.t, playing: window.__ed.playing, s1: window.__ed.startOf(1), o: window.__ed.ovl(0), m: window.__ed.P.clips.map((c) => [c.media.slice(0, 4), c.in, c.out]) })))));
  await ed(() => { window.__ed.pause(); window.__ed.P.clips[0].tr = { kind: "black", dur: 0.6 }; });
  await page.click(".panel-head >> text=Готово");

  // субтитры
  await tool("subs");
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
  await tool("fx"); await page.click(".fx-tiles >> text=Облако");
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
  // наложения: стикер из ПАК и видео поверх основного
  await tool("overlay");   // одно касание — сразу выбор файла
  await page.click(".sheet .item >> text=Звезда.png");
  await page.waitForFunction(() => window.__ed.P.overlays.length === 1 && document.querySelector(".ov.sel"));
  const ov0 = await ed(() => window.__ed.P.overlays[0]);
  await ed(() => window.__ed.seek(window.__ed.P.overlays[0].start + 0.5)); await page.waitForTimeout(400);
  const alphaAt = (fx, fy) => page.evaluate(([fx, fy]) => { const c = document.querySelector("canvas.over"); return c.getContext("2d").getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data[3]; }, [fx, fy]);
  ok(ov0.kind === "image" && await alphaAt(ov0.x, ov0.y) > 200, "стикер из «Для монтажа ПАК» лёг поверх видео");
  await page.locator('input[aria-label="Размер"]').fill("0.3"); await page.locator('input[aria-label="Прозрачность"]').fill("0.9");
  ok(await ed(() => window.__ed.P.overlays[0].scale) === 0.3, "размер наложения меняется ползунком");
  const vb2 = await page.locator(".view canvas").first().boundingBox();
  await page.mouse.move(vb2.x + vb2.width * 0.5, vb2.y + vb2.height * 0.5); await page.mouse.down(); await page.mouse.move(vb2.x + vb2.width * 0.75, vb2.y + vb2.height * 0.3, { steps: 5 }); await page.mouse.up();
  const ov1 = await ed(() => window.__ed.P.overlays[0]);
  ok(ov1.x > 0.65 && ov1.y < 0.4, `наложение двигается пальцем по видео (${ov1.x.toFixed(2)}, ${ov1.y.toFixed(2)})`);
  // ключи у наложения: ◆+ здесь, дальше другой размер — второй ключ, между ними плавно
  await page.click('[data-tool="key-add"]');
  await ed(() => window.__ed.seek(window.__ed.P.overlays[0].start + 1.5)); await page.waitForTimeout(200);
  await page.locator('input[aria-label="Размер"]').fill("0.7"); await page.waitForTimeout(100);
  const ok2 = await ed(() => { const o = window.__ed.P.overlays[0]; return { n: o.keys?.length, a: o.keys?.[0]?.scale, b: o.keys?.[1]?.scale, kf: document.querySelectorAll(".ov .kf").length }; });
  ok(ok2.n === 2 && ok2.a === 0.3 && ok2.b === 0.7 && ok2.kf === 2, `ключи у наложения: размер ${ok2.a} → ${ok2.b}, ◆ на плашке`);
  await shot("10k-ovkeys");
  await ed(() => { delete window.__ed.P.overlays[0].keys; window.__ed.seek(window.__ed.P.overlays[0].start + 0.5); });
  await page.click(".panel .tabs >> text=Анимация"); await page.click(".tiles >> text=Прыжок");
  await page.click(".panel .tabs >> text=Маска"); await page.click(".panel .tiles >> text=Круг");
  ok(await ed(() => window.__ed.P.overlays[0].in === "pop" && window.__ed.P.overlays[0].mask?.shape === "ellipse"), "у наложения своя анимация и маска");
  await page.click(".panel .tabs >> text=Вид"); await page.click(".panel .tiles >> text=Осветление"); await page.waitForTimeout(250);
  const ob = await page.evaluate(() => { const b = document.querySelector("canvas.blend:not([hidden])"); return { m: window.__ed.P.overlays[0].blend, css: b && getComputedStyle(b).mixBlendMode, job: window.__ed.job().overlays[0].blend }; });
  ok(ob.m === "screen" && ob.css === "screen" && ob.job === "screen", "режим смешивания наложения: «Осветление» в превью и у сборщика");
  await shot("10l-blend");
  await page.click(".panel .tiles >> text=Обычный");
  ok(await ed(() => !window.__ed.P.overlays[0].blend), "и обратно «Обычный»");
  await page.evaluate(() => { const P = window.__ed.P, k = window.__ed.P.clips[0].media; window.__ed.addOverlayVideo({ key: k, ...P.media[k] }); });
  await page.waitForFunction(() => window.__ed.P.overlays.length === 2 && document.querySelectorAll(".tl-ovs .orow").length === 2, null, { timeout: 8000 });
  ok(true, "видео-наложение встало на второй этаж дорожки наложений");
  const ovv = await ed(() => window.__ed.P.overlays[1]);
  await ed(() => window.__ed.seek(window.__ed.P.overlays[1].start + 0.6)); await page.waitForTimeout(700);
  ok(await alphaAt(ovv.x, ovv.y) > 200, "видео-наложение видно на превью");
  await shot("7j-overlay");
  const gro = await page.locator(".ov.sel .g.r").boundingBox(), oe0 = ovv.end;
  await page.mouse.move(gro.x + 5, gro.y + 10); await page.mouse.down(); await page.mouse.move(gro.x - 30, gro.y + 10, { steps: 4 }); await page.mouse.up();
  ok(await ed(() => window.__ed.P.overlays[1].end) < oe0 - 0.1, "видео-наложение укорачивается за край");
  await page.click('[data-tool="delete"]');   // удалить — корзина у ▶ (одна на всё)
  ok(await ed(() => window.__ed.P.overlays.length) === 1, "наложение удаляется");
  // титры: свой текст поверх видео
  await page.click('.panel-head >> text=Готово');
  await tool("text");   // одно касание — текст уже стоит здесь
  await page.waitForFunction(() => window.__ed.P.texts.length === 1 && document.querySelector(".tx.sel"));
  await page.fill("textarea.txt", "ЗАГОЛОВОК\nвторая строка");
  const tx0 = await ed(() => window.__ed.P.texts[0]);
  await ed(() => window.__ed.seek(window.__ed.P.texts[0].start + 1)); await page.waitForTimeout(300);
  ok(tx0.text === "ЗАГОЛОВОК\nвторая строка" && await alphaAt(0.5, 0.3) >= 0, "титр добавлен, текст правится, Enter — новая строка");
  const subs0 = await ed(() => JSON.stringify(window.__ed.P.subs.style));
  await page.click(".panel .tabs >> text=Стили"); await page.click('.presets [aria-label="Неон"]'); await page.waitForTimeout(200);
  ok(await ed(() => window.__ed.P.texts[0].style.glow) > 0 && await ed(() => JSON.stringify(window.__ed.P.subs.style)) === subs0, "стиль титра меняется, субтитры не задеты");
  await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 8000 });
  const vb3 = await page.locator(".view canvas").first().boundingBox();
  await page.mouse.move(vb3.x + vb3.width * 0.5, vb3.y + vb3.height * 0.3); await page.mouse.down(); await page.mouse.move(vb3.x + vb3.width * 0.5 + 1, vb3.y + vb3.height * 0.15, { steps: 4 }); await page.mouse.up();
  ok(await ed(() => window.__ed.P.texts[0].style.y) < 0.2, "титр двигается пальцем по видео");
  // ключи у текста: ◆+ здесь, дальше подвинуть пальцем — второй ключ
  await page.click('[data-tool="key-add"]');
  await ed(() => window.__ed.seek(window.__ed.P.texts[0].start + 1.2)); await page.waitForTimeout(200);
  await page.mouse.move(vb3.x + vb3.width * 0.5, vb3.y + vb3.height * 0.15); await page.mouse.down(); await page.mouse.move(vb3.x + vb3.width * 0.5 + 1, vb3.y + vb3.height * 0.55, { steps: 4 }); await page.mouse.up();
  const tk = await ed(() => { const x = window.__ed.P.texts[0], K = x.keys || [], here = K.find((k) => Math.abs(k.t - 1.2) < 0.05), other = K.find((k) => k !== here); return { n: K.length, y0: other?.y, y1: here?.y, kf: document.querySelectorAll(".tx .kf").length }; });
  ok(tk.n === 2 && tk.y1 > tk.y0 + 0.2 && tk.kf === 2, `ключи у текста: место ${tk.y0?.toFixed(2)} → ${tk.y1?.toFixed(2)}, ◆ на плашке`);
  ok(await ed(() => window.__ed.job().subs.lines.some((l) => l.keys?.length === 2)), "ключи текста уходят сборщику");
  await ed(() => { delete window.__ed.P.texts[0].keys; });
  await page.click(".panel .tabs >> text=Анимация"); await page.click(".panel .seg >> text=Появление"); await page.click(".panel .tiles.anim button[aria-label='Печать']");
  ok(await ed(() => window.__ed.P.texts[0].style.in) === "type", "у титра своя анимация");
  await ed(() => window.__ed.seek(window.__ed.P.texts[0].start + 1.5)); await page.waitForTimeout(300);
  await shot("7l-text");
  // «Копия» текста — одной кнопкой
  await page.click(".panel-head .copy-obj");
  ok(await ed(() => window.__ed.P.texts.length === 2 && window.__ed.P.texts[1].start > window.__ed.P.texts[0].start && window.__ed.txtSel === window.__ed.P.texts[1].id), "«Копия» текста встаёт после него и выбрана");
  await page.click('[aria-label="Отменить"]');
  // эффекты: касание — эффект здесь; вспышка белит кадр, тряска двигает кадр, всё уходит сборщику
  await page.click('.panel-head >> text=Готово');
  await ed(() => { window.__ed.pause(); window.__ed.seek(1); });
  await tool("fx");
  await page.click('.fx-tiles [data-fx="flash"]');
  await page.waitForFunction(() => window.__ed.P.effects.length === 1 && document.querySelector(".fx.sel"));
  await ed(() => window.__ed.pause());
  const fx0 = await ed(() => window.__ed.P.effects[0]);
  await ed(() => window.__ed.seek(window.__ed.P.effects[0].start + 0.12)); await page.waitForTimeout(250);
  const wh = await page.evaluate(() => { const c = document.querySelector("canvas.over"), d = c.getContext("2d").getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return d[0] > 240 && d[3] > 100; });
  ok(fx0.kind === "flash" && wh, "«Вспышка» встала с места линии и белит кадр");
  await page.click('.fx-tiles [data-fx="shake"]');
  ok(await ed(() => window.__ed.P.effects[0].kind) === "shake", "эффект меняется касанием плитки");
  await page.locator('.panel input[aria-label="Сила"]').fill("1.2");
  const jf = await ed(() => window.__ed.job().effects);
  ok(jf?.length === 1 && jf[0].kind === "shake" && jf[0].amount === 1.2, "эффект и его сила уходят сборщику");
  await shot("7m-fx");
  await page.click(".panel-head .copy-obj");
  ok(await ed(() => window.__ed.P.effects.length) === 2, "«Копия» эффекта");
  await page.click('[data-tool="delete"]');
  ok(await ed(() => window.__ed.P.effects.length) === 1 && await page.locator(".fx-tiles [data-fx=leak]").count() === 1, "эффект удаляется, видно все эффекты");
  await page.locator(".tl-fx .fx").first().click(); await page.click('[data-tool="fx"]');   // выбран эффект: «Эффекты» ещё раз — снова список
  ok(await page.locator(".fx-tiles [data-fx=leak]:not(.on)").count() === 1 && !(await page.locator(".panel-head .copy-obj").count()), "«Эффекты» при выбранном эффекте — снова все эффекты");
  await page.click('.fx-tiles [data-fx="leak"]'); await ed(() => window.__ed.pause());
  await ed(() => window.__ed.seek(window.__ed.P.effects[1].start + 1)); await page.waitForTimeout(250);
  const bl = await page.evaluate(() => { const b = document.querySelector("canvas.blend:not([hidden])"); return b && getComputedStyle(b).mixBlendMode; });
  ok(bl === "screen", "«Блик» смешивается с видео (Осветление)");
  await shot("7n-leak");
  await ed(() => { window.__ed.P.effects.length = 0; window.__ed.layout(); window.__ed.seek(0); });
  // музыка и звуки
  await page.click('.panel-head >> text=Готово');
  await ed(() => window.__ed.seek(0));
  await tool("sound"); await page.click("text=Добавить музыку или звук здесь");
  await page.click(".sheet .item.snd >> text=Добавить");
  await page.waitForFunction(() => window.__ed.P.sounds.length === 1 && document.querySelector(".sn.sel"));
  ok(true, "музыка из «Для монтажа ПАК» встала на свою дорожку");
  await page.locator('input[aria-label="Громкость"]').fill("0.4"); await page.locator('input[aria-label="Плавное начало"]').fill("0.5");
  await page.click(".panel >> text=Приглушать, когда говорят");
  const sx = await ed(() => window.__ed.P.sounds[0]);
  ok(sx.volume === 0.4 && sx.fadeIn === 0.5 && sx.duck === true, "громкость, плавное начало и приглушение под голос настраиваются");
  const grs = await page.locator(".sn.sel .g.r").boundingBox();
  await page.mouse.move(grs.x + 5, grs.y + 10); await page.mouse.down(); await page.mouse.move(grs.x - 30, grs.y + 10, { steps: 4 }); await page.mouse.up();
  ok(await ed(() => window.__ed.P.sounds[0].end) < sx.end - 0.1, "звук обрезается за край");
  await ed(() => window.__ed.seek(window.__ed.P.sounds[0].start)); await page.click(".play"); await page.waitForTimeout(700);
  ok(await ed(() => { const r = [...window.__ed.sndEls.values()][0]; return r && r.ok && !r.el.paused && r.el.currentTime > 0.15; }), "музыка играет вместе с видео в превью");
  await page.click(".play"); await page.waitForTimeout(150);
  ok(await ed(() => [...window.__ed.sndEls.values()][0].el.paused), "и останавливается вместе с ним");
  await page.click(".panel >> text=Улучшить голос");
  ok(await ed(() => window.__ed.P.voice.denoise > 0 && window.__ed.P.voice.lufs === -14), "«Улучшить голос» одной кнопкой");
  await page.click(".panel >> text=Тонкая настройка"); await page.locator('input[aria-label="Убрать шум (фон, вентилятор)"]').fill("0.7");
  ok(await ed(() => window.__ed.P.voice.denoise) === 0.7, "тонкая настройка голоса");
  await shot("7k-sound");
  await page.click(".panel-head >> text=Готово");

  // воспроизведение через склейку
  await ed(() => window.__ed.seek(0));
  await page.click(".play"); await page.waitForTimeout(1500);
  const tp = await ed(() => window.__ed.t);
  ok(tp > 0.8 && tp < 2.5, `воспроизведение идёт (за 1,5 с ушло на ${tp.toFixed(2)} с)`);
  await page.waitForFunction(() => !window.__ed.playing, null, { timeout: 15000 });
  ok(Math.abs(await ed(() => window.__ed.t - window.__ed.total())) < 0.1, "доиграло до конца через склейки и остановилось");
  // полноэкранный просмотр
  if (await page.locator(".panel-head >> text=Готово").count()) await page.click(".panel-head >> text=Готово");
  const cw0 = (await page.locator(".view canvas").first().boundingBox()).height;
  await page.click(".full-btn"); await page.waitForTimeout(400);
  const cw1 = (await page.locator(".view canvas").first().boundingBox()).height;
  ok(await page.locator(".ed.full").count() === 1 && !(await page.locator(".tl").isVisible()) && cw1 > cw0 * 1.1, `на весь экран: только видео, оно больше (${Math.round(cw0)} → ${Math.round(cw1)})`);
  await ed(() => window.__ed.seek(1)); await page.click(".fs-ctl .fs-play");
  ok(await page.waitForFunction(() => window.__ed.playing && window.__ed.t > 1.1, null, { timeout: 5000 }).then(() => true, () => false), "на весь экране видео играет");
  await page.mouse.click(10, 10); await page.waitForTimeout(150);   // кнопки ещё видны (прячутся через 2,5 с) — касание ставит паузу
  ok(!(await ed(() => window.__ed.playing)), "касание по видео — пауза");
  await shot("16-full");
  await page.click(".fs-ctl >> text=Свернуть"); await page.waitForTimeout(300);
  ok(await page.locator(".ed.full").count() === 0 && await page.locator(".tl").isVisible(), "«Свернуть» возвращает монтаж");
  await ed(() => window.__ed.seek(2)); await page.waitForTimeout(200);
  await shot("10-editor");

  // подготовка второго файла закончилась?
  await tool("media");
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
  await page.click(".export .seg >> text=На это устройство");
  await page.click("text=Собрать видео");
  await page.waitForSelector(".step.now");
  await shot("12-export-progress");
  await page.waitForSelector("text=Сохранить в «Файлы»", { timeout: 60000 });
  ok(true, "«На это устройство»: готовое видео само скачалось из облака");
  await shot("13-export-done");
  await page.click("text=Сохранить в «Файлы»"); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !Object.keys(window.__fakeFiles).some((k) => k.startsWith("10 бит/.studio/out/"))) && await page.locator("text=Видео сохранено на устройство").count() === 1, "после сохранения временная копия в облаке удалена");
  const job = await page.evaluate(async () => { const k = Object.keys(window.__fakeFiles).find((x) => x.includes("/jobs/")); return JSON.parse(await window.__fakeFiles[k].text()); });
  const d2 = await page.evaluate(() => window.__fakeLog.find((l) => l.startsWith("dispatch export")));
  ok(job.deliver === "device", "сборщику передано: положить для устройства");
  ok(job.subs.transitions?.[0]?.kind === "black", "переход ушёл сборщику");
  ok(job.output.w === 2160 && job.output.h === 3840 && job.timeline.length === 2 && job.grade.exposure === 0.8 && Object.values(job.clips)[0].file.startsWith("#"), "проект для сборщика лёг в MEGA: 4K, клипы, цвет, имена хешем");
  ok(job.subs && job.subs.lines.length >= 2 && job.subs.lines[0].words[0].text && job.subs.style.font, "субтитры ушли сборщику вместе с проектом");
  ok(job.subs.fonts?.[0]?.path === "Для монтажа ПАК/Шрифты/Мой шрифт.ttf", "сборщику передан путь к своему шрифту в MEGA");
  ok(job.subs.lines.some((l) => l.style?.font === "Oswald") && job.subs.lines.some((l) => l.words.some((w) => w.style?.color === "#ff00aa")) && job.subs.clouds?.length === 1 && job.subs.clouds[0].a === 0.8, "свои настройки строк и слов и облако ушли сборщику");
  ok(job.subs.lines.some((l) => l.style?.layer === 1), "слой субтитра ушёл сборщику");
  ok(job.overlays?.length === 1 && job.overlays[0].path === "Для монтажа ПАК/Стикеры/Звезда.png" && job.overlays[0].in === "pop" && !job.overlays[0].image, "наложение ушло сборщику (путь к картинке в MEGA)");
  ok(job.subs.lines.some((l) => l.layer >= 100 && l.style.in === "type" && l.words.some((w) => w.br)), "титр ушёл сборщику вместе со своим стилем");
  ok(job.audio.denoise === 0.7 && job.audio.comp > 0, "обработка голоса ушла сборщику");
  ok(job.sounds?.length === 1 && job.sounds[0].path === "Для монтажа ПАК/Музыка/Спокойная.webm" && job.sounds[0].volume === 0.4 && job.sounds[0].duck, "музыка ушла сборщику (путь в MEGA, громкость, приглушение)");
  ok(job.subs.masks?.length === 1 && job.subs.masks[0].shape === "ellipse" && job.subs.masks[0].start === 0, "маска клипа ушла сборщику");
  ok(!d2.includes(job.name) && !d2.includes("clips"), "в GitHub ушёл только номер задания");
  await page.click('.sheet [aria-label="Закрыть"]');

  // проект в облаке: уходит сам, новая версия «из чата» подтягивается
  await ed(() => window.__ed.push()); await page.waitForTimeout(300);
  const pid = await ed(() => window.__ed.P.id);
  ok(await page.evaluate((id) => !!window.__fakeFiles["10 бит/.studio/projects/" + id + ".json"], pid), "версия владельца сама сохраняется в MEGA, в папку приложения");
  await page.evaluate(async (id) => { const k = "10 бит/.studio/projects/" + id + ".json", p = JSON.parse(await window.__fakeFiles[k].text()); p.name = "Правка из чата"; p.by = "claude"; p.updated = Date.now() + 5000; p.grade.contrast = 0.33; await window.__fakeCloud.putText("10 бит/.studio/from-chat", id + ".json", JSON.stringify(p)); }, pid);
  await ed(() => window.__ed.checkRemote()); await page.waitForTimeout(400);
  ok(await ed(() => window.__ed.P.name) === "Правка из чата" && await ed(() => window.__ed.P.grade.contrast) === 0.33 && (await page.locator(".bar .title").textContent()) === "Правка из чата", "открытый проект обновился версией из чата");
  await page.evaluate(() => window.__fakeCloud.putText("10 бит/.studio/from-chat", "mchat1.json", JSON.stringify({ id: "mchat1", name: "Ролик от Claude", by: "claude", created: 1, updated: Date.now(), format: "9:16", clips: [], media: {}, grade: {}, volume: 1, words: {}, clouds: [] })));

  // назад и снова открыть — проект сохранился
  await page.click(".bar .link");
  await page.waitForSelector(".card:not(.new)");
  await page.waitForSelector(".newtag", { timeout: 10000 });
  ok((await page.locator(".card >> text=Ролик от Claude").count()) === 1, "проект, положенный чатом, появился на главном экране с пометкой");
  await shot("14-home-projects");
  // удаление в приложении не трогает файл чата, и проект сам не возвращается
  await page.locator(".card", { hasText: "Ролик от Claude" }).locator(".del").click(); await page.click(".sheet .btn.danger"); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !!window.__fakeFiles["10 бит/.studio/from-chat/mchat1.json"]) && !(await page.locator(".card >> text=Ролик от Claude").count()), "удаление проекта в приложении не удаляет файл чата");
  await page.reload(); await page.waitForSelector(".card:not(.new)"); await page.waitForTimeout(1200);
  ok(!(await page.locator(".card >> text=Ролик от Claude").count()), "удалённый проект сам не возвращается из облака");
  await page.click(".card >> text=Правка из чата");
  await page.waitForFunction(() => window.__ed && window.__ed.P.clips.length === 2);
  await page.waitForFunction(() => { const c = document.querySelector(".view canvas"), g = c.getContext("webgl"), b = new Uint8Array(4); g.readPixels(c.width >> 1, c.height >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, b); return b[0] + b[1] + b[2] > 30; });
  ok(true, "после перезапуска проект и превью на месте");
  // быстрый монтаж в новом проекте: добавить видео → одна кнопка
  await page.click(".bar .link"); await page.waitForSelector(".card.new"); await page.click(".card.new");
  await page.click(".empty .btn"); await page.waitForSelector(".lib .item >> text=Съёмка 1.mov");
  await page.click(".lib .item >> text=Съёмка 1.mov"); await page.waitForSelector(".lib .badge.on"); await page.click(".lib-foot .btn");
  await page.waitForSelector(".panel >> text=Сделать монтаж");
  ok(true, "после первого видео сразу открылся «Быстрый монтаж»");
  await shot("15-quick");
  await page.click(".panel >> text=Сделать монтаж");
  await page.waitForFunction(() => window.__ed.P.subs && window.__ed.P.voice?.denoise > 0, null, { timeout: 15000 });
  ok(await ed(() => window.__ed.P.clips[0].in > 0.1 && window.__ed.P.look?.id && window.__ed.lines.length > 0), "быстрый монтаж: паузы обрезаны, субтитры, голос и цвет — одной кнопкой");
  await page.click('[aria-label="Отменить"]');
  ok(await ed(() => !window.__ed.P.subs && window.__ed.P.clips[0].in === 0), "и отменяется одной стрелкой");
  ok(errors.length === 0, "нет ошибок в консоли" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
  await ctx.close();
}
{
  const page = await browser.newPage(); await page.goto(URL0);
  ok(await page.evaluate(async () => typeof (await import("./vendor/mega.mjs")).Storage === "function"), "библиотека MEGA загружается в браузере");
  await page.close();
}
const only = process.env.ONLY;   // ONLY=iphone — одно устройство
if (!only || only === "ipad") await run("ipad", { width: 1180, height: 820 }, 2);
if (!only || only === "iphone") await run("iphone", { width: 390, height: 844 }, 2);
if (!only || only === "ipad-portrait") await run("ipad-portrait", { width: 820, height: 1180 }, 1);
await browser.close();
console.log(failed ? `НЕ ПРОШЛО: ${failed}` : "всё прошло");
process.exit(failed ? 1 : 0);
