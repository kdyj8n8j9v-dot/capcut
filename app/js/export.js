// Экспорт: проект кладём в MEGA (не в GitHub — репозиторий публичный), сборщику передаём только номер задания.
import { h, icon, sheet, toast, fmtTime, fmtSize, fill } from "./ui.js";
import { db, uid, settings } from "./store.js";
import { cloud, PATHS } from "./cloud.js";
import { github, waitRun } from "./github.js";
import { isUploaded, busyOf } from "./media.js";
import { buildLines, normStyle, textLines, FONTS } from "./subs.mjs";
import { clipLen, curveMap, clipStarts, overlapAfter } from "./speed.mjs";
import { keysForJob } from "./keys.mjs";
import { packFont } from "./fonts.js";

const safe = (n) => (n || "Ролик").replace(/[\/\\:*?"<>|]/g, "-").trim() || "Ролик";
const r3 = (x) => Math.round(x * 1000) / 1000;
export function buildJob(P, out, req) {
  const { starts, total: dur } = clipStarts(P.clips);   // с учётом наплывов
  const ovs = (P.overlays || []).filter((o) => o.start < dur);
  const used = [...new Set([...P.clips.map((c) => c.media), ...ovs.filter((o) => o.kind === "video").map((o) => o.media)])];
  const style = normStyle(P.subs?.style), lines = [...(P.subs?.on ? buildLines(P.clips, P.words || {}, style) : []), ...textLines(P.texts)];   // субтитры + титры
  const clouds = (P.clouds || []).filter((c) => c.start < dur).map(({ id, ...c }) => ({ ...c, start: r3(c.start), end: r3(Math.min(c.end, dur)) }));
  const effects = (P.effects || []).filter((f) => f.start < dur).map(({ id, ...f }) => ({ ...f, start: r3(f.start), end: r3(Math.min(f.end, dur)) }));
  const masks = []; P.clips.forEach((c, i) => { if (c.mask && c.mask.shape && c.mask.shape !== "none") masks.push({ ...c.mask, start: r3(starts[i]), end: r3(starts[i] + clipLen(c)) }); });
  // переходы-рисунки поверх видео; наплыв — смешение самих клипов: его собирает render.py (xfade у клипа)
  const trs = []; P.clips.forEach((c, i) => { if (c.tr && c.tr.kind !== "none" && c.tr.kind !== "dissolve" && i < P.clips.length - 1) trs.push({ at: r3(starts[i + 1]), kind: c.tr.kind, dur: c.tr.dur || 0.5 }); });
  // свои шрифты (общий, отдельных строк и слов): сборщик возьмёт те же файлы из MEGA
  const names = new Set([style.font, ...lines.flatMap((l) => [l.style?.font, ...l.words.map((w) => w.style?.font)])].filter((n) => n && !FONTS[n]));
  const pf = [...names].map(packFont).filter(Boolean).map((f) => ({ name: f.name, path: f.path + "/" + f.file }));
  return {
    id: req, name: safe(P.name), output: { w: out.w, h: out.h },
    clips: Object.fromEntries(used.map((k) => [k, { file: "#" + k }])),
    timeline: P.clips.map((c, i) => ({ clip: c.media, in: r3(c.in), out: r3(c.out), ...(overlapAfter(P.clips, i) > 0 ? { xfade: r3(overlapAfter(P.clips, i)) } : {}), ...(c.curve ? { map: curveMap(c) } : c.speed && c.speed !== 1 ? { speed: c.speed } : {}), ...(c.frame ? { frame: c.frame } : {}), ...(c.grade ? { grade: c.grade } : {}), ...(c.keys?.length ? { keys: keysForJob(c) } : {}), ...(c.mute ? { mute: true } : c.volume != null && c.volume !== 1 ? { volume: c.volume } : {}) })),
    ...(effects.length ? { effects } : {}),
    grade: P.grade || {}, audio: { volume: P.volume ?? 1, ...(P.voice || {}) },
    ...((P.sounds || []).length ? { sounds: P.sounds.filter((x) => x.start < dur && P.audios?.[x.audio]?.path).map(({ id, audio, layer, ...x }) => ({ ...x, path: P.audios[audio].path, start: r3(x.start), end: r3(Math.min(x.end, dur)), from: r3(x.from || 0) })) } : {}),
    ...(ovs.length ? { overlays: ovs.map(({ id, media, image, ...o }) => ({ ...o, start: r3(o.start), end: r3(Math.min(o.end, dur)),
      ...(o.kind === "video" ? { clip: media, from: r3(o.from || 0) } : { path: P.images?.[image]?.path || "" }) })).filter((o) => o.kind === "video" || o.path) } : {}),
    ...(lines.length || clouds.length || masks.length || trs.length ? { subs: { style, ...(clouds.length ? { clouds } : {}), ...(masks.length ? { masks } : {}), ...(trs.length ? { transitions: trs } : {}), ...(pf.length ? { fonts: pf } : {}), lines: lines.map((l) => ({ start: r3(l.start), end: r3(l.end), ...(l.layer ? { layer: l.layer } : {}), ...(l.style ? { style: l.style } : {}), ...(l.keys ? { keys: l.keys } : {}), words: l.words.map((w) => ({ text: w.text, start: r3(w.start), end: r3(w.end), ...(w.em ? { em: true } : {}), ...(w.br ? { br: true } : {}), ...(w.style ? { style: w.style } : {}) })) })) } } : {}),
  };
}
const STEPS = [["send", "Отправляю проект"], ["queued", "Жду свободный сборщик"], ["setup", "Сборщик готовится"], ["work", "Собираю видео в 4K"], ["done", "Готово"]];

const DELIVER = [["mega", "В MEGA"], ["device", "На это устройство"], ["both", "Туда и туда"]];
const MAX_DEVICE = 1.5e9;   // больше — браузер iPad может не удержать файл целиком; такой файл берётся из приложения MEGA

export function openExport(P, out) {
  let alive = true, blob = null, loading = false, loadErr = "";
  const box = h("div.export");
  const s = sheet("Экспорт", box, { onclose: () => { alive = false; } });
  const dur = clipStarts(P.clips).total;
  const saveP = () => db.put("projects", P).catch(() => {});
  let deliver = settings.get("deliver") || "mega";
  const where = (d) => d === "mega" ? "Готовый файл появится в MEGA, в папке «10 бит»." : d === "device" ? "Готовый файл приложение само скачает — останется сохранить его в «Файлы». В MEGA он не останется." : "Готовый файл будет в MEGA, в папке «10 бит», и приложение само скачает его на устройство.";
  const remote = () => P.export.deliver === "device" ? { dir: PATHS.studio + "/out", name: P.export.req + ".mov" } : { dir: PATHS.out, name: P.export.file };

  function intro(err) {
    fill(box,
      h("div.spec", {}, h("b", {}, `${out.w}×${out.h} · 4K`), h("span", {}, "H.265 · 10 бит · 4:2:2 · наивысшее качество"), h("span.muted", {}, `Длительность ${fmtTime(dur)}`)),
      err && h("p.error", {}, err),
      h("div.sl-top.strong", {}, "Куда положить готовое видео"),
      h("div.seg", {}, DELIVER.map(([k, n]) => h("button" + (deliver === k ? ".on" : ""), { onclick: () => { deliver = k; settings.set("deliver", k); intro(err); } }, n))),
      h("p.muted", {}, "Видео соберётся из оригиналов в облаке. " + where(deliver) + " Приложение можно закрыть."),
      h("button.btn.primary.wide.big", { onclick: start }, "Собрать видео"));
  }
  function progress(phase, extra) {
    const at = STEPS.findIndex((x) => x[0] === phase), d = P.export?.deliver || "mega";
    const toDevice = phase === "done" && d !== "mega";
    fill(box,
      h("div.steps", {}, STEPS.map(([id, label], i) => h("div.step" + (i < at || phase === "done" ? ".past" : i === at ? ".now" : ""), {},
        h("i", {}, i < at || phase === "done" ? icon("check", 14) : null), h("span", {}, label + (id === "work" && i === at && extra ? " — " + extra : ""))))),
      phase === "done"
        ? [h("p.muted", {}, d === "device" ? (P.export.saved ? "Видео сохранено на устройство." : "Видео готово. Сохраните его в «Файлы» — копия в облаке потом удалится сама.") : `Файл «${P.export.file}» лежит в MEGA, в папке «10 бит».`),
          loadErr && h("p.error", {}, loadErr),
          h("button.btn.primary.wide.big.save", { onclick: saveToFiles, disabled: loading }, icon("down", 18), loading ? "Скачиваю…" : blob ? "Сохранить в «Файлы»" : "Скачать на устройство"),
          h("button.btn.wide", { onclick: () => { P.export = null; blob = null; saveP(); intro(); } }, "Собрать заново")]
        : [h("p.muted", {}, "Можно закрыть это окно и приложение: сборка идёт в облаке. Обычно это занимает в несколько раз больше длительности ролика."),
          h("button.btn.wide", { onclick: () => { P.export = null; saveP(); alive = false; s.close(); } }, "Отменить слежение")]);
    if (toDevice && !blob && !loading && !loadErr && !P.export.saved) fetchResult();   // скачать само, как только готово
  }
  async function start() {
    try {
      if (!cloud.signedIn()) throw new Error("Войдите в MEGA в «Настройках».");
      if (!github.has()) throw new Error("Добавьте токен GitHub в «Настройках».");
      progress("send");
      for (const x of P.sounds || []) if (busyOf(x.audio)?.text?.startsWith("Загружаю")) throw new Error("Музыка ещё загружается в MEGA. Дождитесь окончания загрузки и попробуйте снова.");
      for (const o of P.overlays || []) if (o.kind === "image" && busyOf(o.image)?.text?.startsWith("Загружаю")) throw new Error("Картинка-наложение ещё загружается в MEGA. Дождитесь окончания загрузки и попробуйте снова.");
      for (const k of new Set([...P.clips.map((c) => c.media), ...(P.overlays || []).filter((o) => o.kind === "video").map((o) => o.media)])) {
        if (busyOf(k)?.text?.startsWith("Загружаю") || !(await isUploaded(k))) throw new Error("Оригинал ещё загружается в MEGA. Дождитесь окончания загрузки и попробуйте снова.");
      }
      const req = "e" + uid(), job = { ...buildJob(P, out, req), deliver };
      await cloud.putText(PATHS.jobs, req + ".json", JSON.stringify(job));
      await github.dispatch("export", { req });
      P.export = { req, at: Date.now(), file: job.name + "-10bit.mov", deliver };
      await saveP();
      follow();
    } catch (e) { intro(e.message); }
  }
  async function follow() {
    const req = P.export.req;
    let phase = "queued", pct = "";
    progress(phase);
    const poll = setInterval(async () => {
      if (!alive) return clearInterval(poll);
      if (phase !== "work") return;
      try {
        await cloud.refresh();
        const p = JSON.parse(await cloud.getText(PATHS.jobs, req + ".progress.json"));
        if (p.total) {
          const left = p.done > 0 ? p.elapsed * (p.total - p.done) / p.done : 0;
          pct = Math.round(100 * p.done / p.total) + " %" + (left > 60 ? `, осталось около ${Math.ceil(left / 60)} мин` : "");
          if (alive && phase === "work") progress(phase, pct);
        }
      } catch {}
    }, 30000);
    try {
      const st = await waitRun(req, (ph) => { phase = ph; if (alive && ph !== "done" && ph !== "failed") progress(ph, pct); }, 8000, () => alive && P.export?.req === req);
      clearInterval(poll);
      if (st.phase === "stopped") return;
      if (st.phase === "done") { P.export.done = true; await saveP(); if (alive) progress("done"); toast("Видео готово"); }
      else { P.export = null; await saveP(); if (alive) intro("Сборка не удалась. Попробуйте ещё раз; если повторится — напишите, что было в проекте."); }
    } catch (e) { clearInterval(poll); if (alive) intro(e.message); }
  }
  // скачать готовый файл из облака на устройство (в память), с ходом в процентах на кнопке
  async function fetchResult() {
    loading = true; loadErr = ""; progress("done");
    try {
      await cloud.refresh();
      const r = remote(), info = (await cloud.list(r.dir) || []).find((f) => f.name === r.name);
      if (!info) throw new Error(P.export.deliver === "device" && P.export.saved ? "Копия в облаке уже удалена." : "Файл ещё не появился в облаке. Попробуйте через минуту.");
      if (info.size > MAX_DEVICE) throw new Error(`Файл большой (${fmtSize(info.size)}) — браузер iPad его не удержит. Откройте приложение MEGA: ${P.export.deliver === "device" ? "папка «10 бит» → «.studio» → «out», файл " + r.name : "папка «10 бит»"} — и сохраните оттуда.`);
      blob = await cloud.download(r.dir, r.name, (p) => { const b = box.querySelector(".save"); if (b) b.textContent = `Скачиваю ${Math.round(p * 100)} %`; });
    } catch (e) { loadErr = e.message; }
    loading = false; if (alive) progress("done");
  }
  async function saveToFiles() {
    if (!blob) return fetchResult();
    const name = P.export.file, f = new File([blob], name, { type: "video/quicktime" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f] });
      else { const a = h("a", { href: URL.createObjectURL(f), download: name }); document.body.append(a); a.click(); a.remove(); }
      if (P.export.deliver === "device" && !P.export.saved) {   // сохранили — временная копия в облаке больше не нужна
        P.export.saved = true; await saveP();
        cloud.remove(remote().dir, remote().name).catch(() => {});
      }
      progress("done");
    } catch (e) { if (e.name !== "AbortError") toast(e.message, 6000); }
  }

  if (P.export?.done) progress("done");
  else if (P.export && Date.now() - P.export.at < 8 * 3600e3) follow();
  else intro();
}
