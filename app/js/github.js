// GitHub: запуск сборщика (workflow studio-worker) и слежение за ним. Токен хранится только на устройстве.
import { settings } from "./store.js";

const pages = location.hostname.endsWith(".github.io");
export const OWNER = pages ? location.hostname.split(".")[0] : "kdyj8n8j9v-dot";
export const REPO = pages ? location.pathname.split("/")[1] || "capcut" : "capcut";
const WF = "studio-worker.yml";

async function api(path, opts = {}) {
  const token = settings.get("gh");
  if (!token) throw new Error("Сначала добавьте токен GitHub в «Настройках».");
  let r;
  try {
    r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
      ...opts, cache: "no-store",
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
  } catch { throw new Error("Нет связи с GitHub. Проверьте интернет."); }
  if (r.status === 401) throw new Error("GitHub не принял токен. Проверьте его в «Настройках».");
  if (r.status === 403 || r.status === 404) throw new Error("У токена нет доступа. Нужны: репозиторий " + REPO + " и право Actions — Read and write.");
  if (!r.ok) throw new Error("GitHub: ошибка " + r.status);
  return r.status === 204 ? null : r.json();
}

const real = {
  has: () => !!settings.get("gh"),
  async check() { await api(`/actions/workflows/${WF}`); return true; },
  // запустить задание; req — наш номер, по нему потом находим запуск
  async dispatch(job, inputs) {
    await api(`/actions/workflows/${WF}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { job, ...inputs } }) });
  },
  async findRun(req) {
    const d = await api(`/actions/workflows/${WF}/runs?event=workflow_dispatch&per_page=30`);
    return (d.workflow_runs || []).find((r) => (r.display_title || r.name || "").includes(req)) || null;
  },
  // состояние: { phase: queued|setup|work|done|failed, url }
  async state(req) {
    const run = await this.findRun(req);
    if (!run) return { phase: "queued" };
    if (run.status === "completed") return { phase: run.conclusion === "success" ? "done" : "failed", url: run.html_url };
    if (run.status !== "in_progress") return { phase: "queued", url: run.html_url };
    let phase = "setup";
    try {
      const j = await api(`/actions/runs/${run.id}/jobs`);
      const steps = j.jobs?.[0]?.steps || [];
      if (steps.some((s) => s.name === "run" && s.status !== "queued" && s.status !== "pending")) phase = "work";
    } catch {}
    return { phase, url: run.html_url };
  },
};
export const github = window.__fakeGithub || real;

// ждать окончания задания; onPhase(phase) — при смене состояния. Возвращает итоговое состояние.
export async function waitRun(req, onPhase, every = 8000, alive = () => true) {
  let last = "", misses = 0;
  while (alive()) {
    let s;
    try { s = await github.state(req); misses = 0; } catch (e) { if (++misses > 8) throw e; s = { phase: last || "queued" }; }
    if (s.phase !== last) { last = s.phase; onPhase && onPhase(s.phase, s); }
    if (s.phase === "done" || s.phase === "failed") return s;
    await new Promise((r) => setTimeout(r, every));
  }
  return { phase: "stopped" };
}
