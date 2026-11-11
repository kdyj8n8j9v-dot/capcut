// MEGA прямо из браузера (библиотека megajs). Вход хранится только на устройстве: ключ сеанса, без пароля.
import { settings } from "./store.js";

export const PATHS = { in: "Исходники", out: "10 бит", studio: "10 бит/.studio", jobs: "10 бит/.studio/jobs", pack: "Для монтажа ПАК" };
const norm = (s) => (s || "").normalize("NFC");
let st = null, opening = null;
const lib = () => import("../vendor/mega.mjs");

function explain(e) {
  const m = String(e && e.message || e);
  if (/-9\b|ENOENT/.test(m)) return "Неверная почта или пароль MEGA.";
  if (/-26\b|EMFAREQUIRED/.test(m)) return "MFA";
  if (/-15\b|ESID/.test(m)) return "Вход в MEGA устарел — войдите заново в «Настройках».";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Нет связи с MEGA. Проверьте интернет.";
  return "MEGA: " + m;
}

const real = {
  signedIn: () => !!settings.get("mega"),
  account: () => settings.get("mega")?.email || "",
  async login(email, password, code) {
    const { Storage } = await lib();
    try {
      const s = new Storage({ email, password, secondFactorCode: code || undefined, keepalive: false });
      await s.ready;
      const j = s.toJSON();
      // пароль не сохраняем: только ключ сеанса
      settings.set("mega", { email, key: j.key, sid: j.sid, name: j.name, user: j.user });
      st = s; opening = null;
    } catch (e) { throw new Error(explain(e)); }
  },
  logout() { settings.set("mega", null); try { st && st.close(); } catch {} st = null; opening = null; },
  async open() {
    if (st) return st;
    const j = settings.get("mega");
    if (!j) throw new Error("Сначала войдите в MEGA в «Настройках».");
    return opening ||= (async () => {
      const { Storage } = await lib();
      try {
        const s = Storage.fromJSON({ key: j.key, sid: j.sid, name: j.name, user: j.user, options: { keepalive: false } });
        await s.reload(true);
        return (st = s);
      } catch (e) { opening = null; throw new Error(explain(e)); }
    })();
  },
  async refresh() { if (st) { try { await st.reload(true); } catch (e) { throw new Error(explain(e)); } } else await this.open(); },
  async folder(path, create) {
    const s = await this.open();
    let f = s.root;
    for (const part of path.split("/").filter(Boolean)) {
      let n = (f.children || []).find((c) => c.directory && norm(c.name) === norm(part))
        || (f.children || []).find((c) => c.directory && norm(c.name).toLowerCase() === norm(part).toLowerCase());
      if (!n) { if (!create) return null; n = await f.mkdir(part); }
      f = n;
    }
    return f;
  },
  // файлы папки: [{ name, size, ts, dir }]
  async list(path) {
    const f = await this.folder(path);
    if (!f) return null;
    return (f.children || []).map((c) => ({ name: norm(c.name), size: c.size || 0, ts: c.timestamp || 0, dir: !!c.directory }));
  },
  // все файлы папки и её подпапок, подходящие под образец: [{ name, path, size }] (path — папка файла)
  async find(path, re) {
    const root = await this.folder(path), out = [];
    const walk = (f, p) => { for (const c of f.children || []) { if (c.directory) walk(c, p + "/" + norm(c.name)); else if (re.test(c.name || "")) out.push({ name: norm(c.name), path: p, size: c.size || 0 }); } };
    if (root) walk(root, path);
    return out;
  },
  async node(path, name) {
    const f = await this.folder(path);
    return f && (f.children || []).find((c) => !c.directory && norm(c.name) === norm(name)) || null;
  },
  async download(path, name, onProgress) {
    const n = await this.node(path, name);
    if (!n) throw new Error("В MEGA нет файла: " + name);
    return new Promise((res, rej) => {
      const parts = []; let got = 0;
      const s = n.download({});
      s.on("data", (d) => { parts.push(new Uint8Array(d)); got += d.length; onProgress && onProgress(got / (n.size || 1)); });
      s.on("end", () => res(new Blob(parts)));
      s.on("error", (e) => rej(new Error(explain(e))));
    });
  },
  async upload(path, name, blob, onProgress) {
    const f = await this.folder(path, true);
    const old = (f.children || []).find((c) => !c.directory && norm(c.name) === norm(name));
    const up = f.upload({ name, size: blob.size });
    const fail = new Promise((_, rej) => up.on("error", (e) => rej(new Error(explain(e)))));
    const CH = 4 << 20;
    const feed = (async () => {
      for (let o = 0; o < blob.size; o += CH) {
        const buf = new Uint8Array(await blob.slice(o, o + CH).arrayBuffer());
        if (!up.write(buf)) await new Promise((r) => up.once("drain", r));
        onProgress && onProgress(Math.min(1, (o + buf.length) / blob.size) * 0.98);
      }
      up.end();
      await up.complete;
      if (old) { try { await old.delete(true); } catch {} }
      onProgress && onProgress(1);
    })();
    await Promise.race([feed, fail]);
  },
  async putText(path, name, text) { await this.upload(path, name, new Blob([text])); },
  async getText(path, name) { return (await this.download(path, name)).text(); },
};

// для автопроверок: страница может подставить свою «MEGA» (tests/)
export const cloud = window.__fakeCloud || real;
