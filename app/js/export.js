// Экспорт: проект кладём в MEGA (не в GitHub — репозиторий публичный), сборщику передаём только номер задания.
import { h, icon, sheet, toast, fmtTime, fmtSize, fill } from "./ui.js";
import { db, uid } from "./store.js";
import { cloud, PATHS } from "./cloud.js";
import { github, waitRun } from "./github.js";
import { isUploaded, busyOf } from "./media.js";
import { buildLines, SUB_DEFAULT } from "./subs.mjs";

const safe = (n) => (n || "Ролик").replace(/[\/\\:*?"<>|]/g, "-").trim() || "Ролик";
const r3 = (x) => Math.round(x * 1000) / 1000;
export function buildJob(P, out, req) {
  const used = [...new Set(P.clips.map((c) => c.media))];
  const style = { ...SUB_DEFAULT, ...(P.subs?.style || {}) }, lines = P.subs?.on ? buildLines(P.clips, P.words || {}, style) : [];
  return {
    id: req, name: safe(P.name), output: { w: out.w, h: out.h },
    clips: Object.fromEntries(used.map((k) => [k, { file: "#" + k }])),
    timeline: P.clips.map((c) => ({ clip: c.media, in: r3(c.in), out: r3(c.out), ...(c.frame ? { frame: c.frame } : {}) })),
    grade: P.grade || {}, audio: { volume: P.volume ?? 1 },
    ...(lines.length ? { subs: { style, lines: lines.map((l) => ({ start: r3(l.start), end: r3(l.end), words: l.words.map((w) => ({ text: w.text, start: r3(w.start), end: r3(w.end) })) })) } } : {}),
  };
}
const STEPS = [["send", "Отправляю проект"], ["queued", "Жду свободный сборщик"], ["setup", "Сборщик готовится"], ["work", "Собираю видео в 4K"], ["done", "Готово"]];

export function openExport(P, out) {
  let alive = true;
  const box = h("div.export");
  const s = sheet("Экспорт", box, { onclose: () => { alive = false; } });
  const dur = P.clips.reduce((a, c) => a + c.out - c.in, 0);
  const saveP = () => db.put("projects", P).catch(() => {});

  function intro(err) {
    fill(box, 
      h("div.spec", {}, h("b", {}, `${out.w}×${out.h} · 4K`), h("span", {}, "H.265 · 10 бит · 4:2:2 · наивысшее качество"), h("span.muted", {}, `Длительность ${fmtTime(dur)}`)),
      err && h("p.error", {}, err),
      h("p.muted", {}, "Видео соберётся из оригиналов в облаке. Приложение можно закрыть — готовый файл появится в MEGA, в папке «10 бит»."),
      h("button.btn.primary.wide.big", { onclick: start }, "Собрать видео"));
  }
  function progress(phase, extra) {
    const at = STEPS.findIndex((x) => x[0] === phase);
    fill(box, 
      h("div.steps", {}, STEPS.map(([id, label], i) => h("div.step" + (i < at || phase === "done" ? ".past" : i === at ? ".now" : ""), {},
        h("i", {}, i < at || phase === "done" ? icon("check", 14) : null), h("span", {}, label + (id === "work" && i === at && extra ? " — " + extra : ""))))),
      phase === "done"
        ? [h("p.muted", {}, `Файл «${P.export.file}» лежит в MEGA, в папке «10 бит».`),
          h("button.btn.primary.wide", { onclick: saveToFiles }, icon("down", 18), "Сохранить на устройство"),
          h("button.btn.wide", { onclick: () => { P.export = null; saveP(); intro(); } }, "Собрать заново")]
        : [h("p.muted", {}, "Можно закрыть это окно и приложение: сборка идёт в облаке. Обычно это занимает в несколько раз больше длительности ролика."),
          h("button.btn.wide", { onclick: () => { P.export = null; saveP(); alive = false; s.close(); } }, "Отменить слежение")]);
  }
  async function start() {
    try {
      if (!cloud.signedIn()) throw new Error("Войдите в MEGA в «Настройках».");
      if (!github.has()) throw new Error("Добавьте токен GitHub в «Настройках».");
      progress("send");
      for (const k of new Set(P.clips.map((c) => c.media))) {
        if (busyOf(k)?.text?.startsWith("Загружаю") || !(await isUploaded(k))) throw new Error("Оригинал ещё загружается в MEGA. Дождитесь окончания загрузки и попробуйте снова.");
      }
      const req = "e" + uid(), job = buildJob(P, out, req);
      await cloud.putText(PATHS.jobs, req + ".json", JSON.stringify(job));
      await github.dispatch("export", { req });
      P.export = { req, at: Date.now(), file: job.name + "-10bit.mov" };
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
  async function saveToFiles() {
    const name = P.export.file, btn = box.querySelector(".btn.primary");
    try {
      await cloud.refresh();
      const info = (await cloud.list(PATHS.out) || []).find((f) => f.name === name);
      if (!info) throw new Error("Файл ещё не появился в MEGA. Попробуйте через минуту.");
      if (info.size > 1.5e9) throw new Error(`Файл большой (${fmtSize(info.size)}). Откройте приложение MEGA, папка «10 бит», и сохраните его оттуда.`);
      btn.disabled = true;
      const blob = await cloud.download(PATHS.out, name, (p) => { btn.textContent = `Скачиваю ${Math.round(p * 100)} %`; });
      const f = new File([blob], name, { type: "video/quicktime" });
      btn.disabled = false; btn.textContent = "Сохранить на устройство";
      if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f] });
      else { const a = h("a", { href: URL.createObjectURL(f), download: name }); document.body.append(a); a.click(); a.remove(); }
    } catch (e) { if (btn) { btn.disabled = false; btn.textContent = "Сохранить на устройство"; } if (e.name !== "AbortError") toast(e.message, 6000); }
  }

  if (P.export?.done) progress("done");
  else if (P.export && Date.now() - P.export.at < 8 * 3600e3) follow();
  else intro();
}
