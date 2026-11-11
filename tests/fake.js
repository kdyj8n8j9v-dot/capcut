// Подставные MEGA и GitHub для автопроверок приложения (без сети и без входа).
(() => {
  const files = {};  // "папка/имя" → Blob
  const log = [];
  const sample = fetch("/tests/sample.webm").then((r) => r.blob());
  const ready = (async () => {
    const b = await sample;
    files["Исходники/Съёмка 1.mov"] = new Blob([new Uint8Array(3e6)]);
    files["Исходники/Съёмка 2.mov"] = new Blob([new Uint8Array(5e6)]);
    files["10 бит/.studio/Съёмка 1.proxy.mp4"] = b;
    files["10 бит/.studio/Съёмка 1.transcript.json"] = new Blob([JSON.stringify({ words: "Привет, это проверка субтитров. Каждое слово стоит на своём месте, и текст можно править!".split(" ").map((x, i) => ({ text: x, start: 0.3 + i * 0.5, end: 0.3 + i * 0.5 + 0.4 })) })]);
  })();
  const s = { get: (k) => JSON.parse(localStorage.getItem("studio." + k)), set: (k, v) => localStorage.setItem("studio." + k, JSON.stringify(v)) };
  window.__fakeLog = log; window.__fakeFiles = files;
  window.__fakeCloud = {
    signedIn: () => !!s.get("mega"), account: () => s.get("mega")?.email || "",
    async login(email, password) { if (password !== "верный") throw new Error("Неверная почта или пароль MEGA."); s.set("mega", { email }); },
    logout() { localStorage.removeItem("studio.mega"); },
    async open() {}, async refresh() { await ready; },
    async list(path) { await ready; const p = path + "/"; return Object.keys(files).filter((k) => k.startsWith(p) && !k.slice(p.length).includes("/")).map((k) => ({ name: k.slice(p.length), size: files[k].size, ts: 1, dir: false })); },
    async download(path, name, onProgress) { await ready; const b = files[path + "/" + name]; if (!b) throw new Error("В MEGA нет файла: " + name); onProgress && onProgress(1); return b; },
    async upload(path, name, blob, onProgress) { onProgress && onProgress(0.5); await new Promise((r) => setTimeout(r, 300)); files[path + "/" + name] = blob; log.push("upload " + path + "/" + name); },
    async putText(path, name, text) { files[path + "/" + name] = new Blob([text]); log.push("put " + path + "/" + name); },
    async getText(path, name) { return (await this.download(path, name)).text(); },
  };
  const runs = {};
  window.__fakeGithub = {
    has: () => !!s.get("gh"),
    async check() { if (s.get("gh") !== "github_pat_ok") throw new Error("GitHub не принял токен. Проверьте его в «Настройках»."); return true; },
    async dispatch(job, inputs) {
      log.push("dispatch " + job + " " + JSON.stringify(inputs)); runs[inputs.req] = { n: 0, job, inputs };
    },
    async state(req) {
      const r = runs[req]; if (!r) return { phase: "queued" };
      r.n++;
      if (r.n >= 3 && r.job === "prepare") { files["10 бит/.studio/Съёмка 2.proxy.mp4"] = await sample; }
      if (r.n >= 3 && r.job === "export") { const j = JSON.parse(await files["10 бит/.studio/jobs/" + req + ".json"].text()); files["10 бит/" + j.name + "-10bit.mov"] = new Blob([new Uint8Array(1000)]); }
      return { phase: ["queued", "setup", "work", "done"][Math.min(3, r.n)] };
    },
  };
})();
