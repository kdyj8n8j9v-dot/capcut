// Главный экран (проекты) и «Настройки».
import { h, icon, sheet, toast, ask, fmtTime } from "./ui.js";
import { db, settings, uid } from "./store.js";
import { cloud } from "./cloud.js";
import { github, REPO } from "./github.js";
import { openEditor } from "./editor.js";
import { resumePending } from "./media.js";

const root = document.getElementById("app");
const day = (ts) => new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

async function home() {
  const projects = (await db.all("projects")).sort((a, b) => b.updated - a.updated);
  const ready = cloud.signedIn() && github.has();
  const open = (p) => openEditor(p, home);
  const create = async () => {
    const p = { id: uid(), name: "Проект " + (projects.length + 1), created: Date.now(), updated: Date.now(), format: "9:16", clips: [], media: {}, grade: {}, volume: 1 };
    await db.put("projects", p); open(p);
  };
  const del = async (p, e) => {
    e.stopPropagation();
    if (await ask("Удалить проект?", `«${p.name}» исчезнет с этого устройства. Видео в MEGA останутся.`)) { await db.del("projects", p.id); home(); }
  };
  root.replaceChildren(h("div.home", {},
    h("header.home-head", {}, h("h1", {}, "Проекты"), h("button.round", { onclick: openSettings, "aria-label": "Настройки" }, icon("gear", 22))),
    !ready && h("button.setup", { onclick: openSettings },
      h("b", {}, "Подключите MEGA и GitHub"), h("span", {}, "Один раз, около трёх минут. Без этого не открыть видео из облака и не собрать готовый файл."), h("span.link.strong", {}, "Открыть настройки")),
    h("div.grid", {},
      h("button.card.new", { onclick: create }, h("div.thumb", {}, icon("plus", 34)), h("b", {}, "Новый проект")),
      projects.map((p) => h("div.card", { onclick: () => open(p), role: "button", tabIndex: 0 },
        h("div.thumb", { style: p.thumb ? { backgroundImage: `url(${p.thumb})` } : {} }, !p.thumb && icon("film", 30),
          h("button.round.del", { onclick: (e) => del(p, e), "aria-label": "Удалить проект" }, icon("trash", 16))),
        h("b", {}, p.name), h("small", {}, `${fmtTime(p.duration || 0)} · ${day(p.updated)}`))))));
}

function openSettings() {
  const body = h("div.settings");
  const s = sheet("Настройки", body, { onclose: home });
  const render = () => {
    // ——— MEGA
    const mail = h("input.field", { type: "email", placeholder: "Почта MEGA", autocomplete: "username", autocapitalize: "off" });
    const pass = h("input.field", { type: "password", placeholder: "Пароль MEGA", autocomplete: "current-password" });
    const code = h("input.field", { inputMode: "numeric", placeholder: "Код из приложения-аутентификатора", hidden: true });
    const mErr = h("p.error", { hidden: true });
    const mBtn = h("button.btn.primary.wide", { onclick: async () => {
      mErr.hidden = true; mBtn.disabled = true; mBtn.textContent = "Вхожу…";
      try { await cloud.login(mail.value.trim(), pass.value, code.value.trim()); toast("MEGA подключена"); render(); }
      catch (e) {
        if (e.message === "MFA") { code.hidden = false; mErr.textContent = "Введите код двухэтапной проверки."; } else mErr.textContent = e.message;
        mErr.hidden = false; mBtn.disabled = false; mBtn.textContent = "Войти";
      }
    } }, "Войти");
    const mega = cloud.signedIn()
      ? [h("div.ok-row", {}, icon("check", 18), h("span", {}, "Вход выполнен: " + cloud.account())), h("button.btn.wide", { onclick: () => { cloud.logout(); render(); } }, "Выйти из MEGA")]
      : [h("p.muted", {}, "Отсюда берутся исходники и сюда же попадает готовое видео."), mail, pass, code, mErr, mBtn];
    // ——— GitHub
    const tok = h("input.field", { type: "password", placeholder: "Токен (начинается с github_pat_)", autocomplete: "off", autocapitalize: "off" });
    const gErr = h("p.error", { hidden: true });
    const gBtn = h("button.btn.primary.wide", { onclick: async () => {
      gErr.hidden = true; gBtn.disabled = true; gBtn.textContent = "Проверяю…";
      settings.set("gh", tok.value.trim());
      try { await github.check(); toast("GitHub подключён"); render(); }
      catch (e) { settings.set("gh", null); gErr.textContent = e.message; gErr.hidden = false; gBtn.disabled = false; gBtn.textContent = "Сохранить и проверить"; }
    } }, "Сохранить и проверить");
    const steps = h("ol.steps-how", {},
      h("li", {}, "Откройте страницу ", h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, "создания токена"), " и войдите в GitHub."),
      h("li", {}, "Token name — напишите «Монтаж». Expiration — выберите самый долгий срок."),
      h("li", {}, "Repository access → Only select repositories → выберите ", h("b", {}, REPO), "."),
      h("li", {}, "Permissions → Repository permissions → Actions → ", h("b", {}, "Read and write"), "."),
      h("li", {}, "Внизу нажмите Generate token, скопируйте его и вставьте сюда."));
    const gh = github.has()
      ? [h("div.ok-row", {}, icon("check", 18), h("span", {}, "Токен сохранён и работает")), h("button.btn.wide", { onclick: () => { settings.set("gh", null); render(); } }, "Удалить токен")]
      : [h("p.muted", {}, "Токен — это ключ, которым приложение запускает сборку видео в облаке."), h("details", {}, h("summary", {}, "Как получить токен — 5 шагов"), steps), tok, gErr, gBtn];
    body.replaceChildren(
      h("section", {}, h("h3", {}, icon("cloud", 20), "MEGA"), mega),
      h("section", {}, h("h3", {}, icon("gear", 20), "GitHub"), gh),
      h("section", {}, h("h3", {}, icon("device", 20), "Приложение на экране «Домой»"),
        h("p.muted", {}, "В Safari нажмите «Поделиться» → «На экран Домой». Приложение будет открываться как обычная программа.")),
      h("p.muted.small", {}, "Пароль не сохраняется. Ключ входа MEGA и токен хранятся только на этом устройстве и никуда, кроме MEGA и GitHub, не отправляются."));
  };
  render();
}

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
navigator.storage?.persist?.().catch(() => {});
home();
resumePending().catch(() => {});
