// Окно «Медиа»: видео из MEGA «Исходники» и с этого устройства.
import { h, icon, sheet, toast, fmtSize, fmtTime } from "./ui.js";
import { cloud } from "./cloud.js";
import { github } from "./github.js";
import { library, ensure, addFromDevice, onMedia, busyOf } from "./media.js";

export function openLibrary({ onPick }) {
  let items = null, error = null, picked = [];
  const list = h("div.list"), addBtn = h("button.btn.primary.wide", { onclick: done }, "Добавить");
  const file = h("input", { type: "file", accept: "video/*", multiple: true, hidden: true, onchange: fromDevice });
  const body = h("div.lib", {},
    h("button.item.accent", { onclick: () => file.click() }, icon("device"), h("span.item-main", {}, h("b", {}, "С этого устройства"), h("small", {}, "«Фото» или «Файлы». Оригинал сам загрузится в MEGA.")), file),
    h("div.sec", {}, h("span", {}, "MEGA · Исходники"), h("button.link", { onclick: () => load(true) }, "Обновить")),
    list, h("div.lib-foot", {}, addBtn));
  const s = sheet("Медиа", body, { wide: true, onclose: () => off() });
  let reT; const off = onMedia(() => { render(); clearTimeout(reT); reT = setTimeout(() => s.el.isConnected && load(), 400); });

  async function load(refresh) {
    error = null; if (refresh) { items = null; render(); }
    try { items = cloud.signedIn() ? await library(refresh) : []; } catch (e) { error = e.message; items = []; }
    render();
  }
  function state(m) {
    const b = busyOf(m.key);
    if (b) return h("span.badge.busy", {}, b.text + (b.p != null ? ` ${Math.round(b.p * 100)} %` : "…"));
    if (m.local && m.dur) return picked.includes(m.key) ? h("span.badge.on", {}, icon("check", 16)) : h("span.badge.ok", {}, fmtTime(m.dur));
    if (m.local || m.proxy) return h("span.badge", {}, icon("down", 16), "Скачать");
    return h("span.badge", {}, "Подготовить");
  }
  function render() {
    addBtn.hidden = !picked.length; addBtn.textContent = picked.length > 1 ? `Добавить ${picked.length}` : "Добавить";
    if (!cloud.signedIn()) return list.replaceChildren(h("p.muted.pad", {}, "Чтобы видеть свои видео из MEGA, войдите в MEGA в «Настройках» на главном экране."));
    if (!items) return list.replaceChildren(h("p.muted.pad", {}, "Загружаю список…"));
    if (error) return list.replaceChildren(h("p.muted.pad", {}, error));
    if (!items.length) return list.replaceChildren(h("p.muted.pad", {}, "В папке «Исходники» пока нет видео."));
    list.replaceChildren(...items.map((m) => h("button.item" + (picked.includes(m.key) ? ".picked" : ""), { onclick: () => tap(m) },
      icon("film"), h("span.item-main", {}, h("b", {}, m.name), h("small", {}, fmtSize(m.size) + (m.local ? " · на устройстве" : m.proxy ? " · в MEGA" : " · нужна подготовка, около 4 минут"))), state(m))));
  }
  async function tap(m) {
    if (busyOf(m.key)) return;
    if (m.local && m.dur) { picked = picked.includes(m.key) ? picked.filter((k) => k !== m.key) : [...picked, m.key]; return render(); }
    if (!m.local && !m.proxy && !github.has()) return toast("Для подготовки нужен токен GitHub — добавьте его в «Настройках»");
    try {
      const rec = await ensure(m);
      if (rec) { Object.assign(m, rec, { local: true }); picked.push(m.key); }
    } catch (e) { toast(e.message, 5000); }
    load();
  }
  async function fromDevice() {
    const fs = [...file.files]; file.value = "";
    if (!fs.length) return;
    if (!cloud.signedIn()) return toast("Сначала войдите в MEGA в «Настройках»: оригинал нужен сборщику", 5000);
    const recs = [];
    for (const f of fs) {
      try {
        const { rec, upload } = await addFromDevice(f);
        upload.then(() => toast("Оригинал в MEGA: можно экспортировать")).catch((e) => toast("Не удалось загрузить в MEGA: " + e.message, 6000));
        if (rec) recs.push(rec); else toast("Это устройство не показывает такой формат. После загрузки подготовлю копию — она появится в списке.", 6000);
      } catch (e) { toast(e.message, 5000); }
    }
    if (recs.length) { onPick(recs); s.close(); toast("Не закрывайте приложение, пока оригинал загружается в MEGA", 5000); } else load();
  }
  function done() { const recs = picked.map((k) => items.find((m) => m.key === k)).filter(Boolean); s.close(); onPick(recs); }
  load();
}
