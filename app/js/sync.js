// Проекты в MEGA. Две папки, чтобы приложение и чат «Монтаж» не затирали друг друга:
//   «10 бит/.studio/from-chat» — сюда чат кладёт монтаж ПО КОМАНДЕ владельца; приложение только читает, никогда не меняет и не удаляет;
//   «10 бит/.studio/projects»  — сюда приложение само сохраняет версию владельца (общая для его устройств); чат читает её
//                                только когда владелец попросит (scripts/project.py get). Формат — docs/PROJECT-FORMAT.md.
import { db, settings } from "./store.js";
import { cloud, PATHS } from "./cloud.js";

const stamp = (f) => f.ts + ":" + f.size;
const seen = () => settings.get("psync") || {};
const mark = (key, st) => settings.set("psync", { ...seen(), [key]: st });
const SOURCES = [["in:", "inbox"], ["", "projects"]];   // приставка отметки, папка
const files = async (dir) => (await cloud.list(PATHS[dir]) || []).filter((f) => !f.dir && f.name.endsWith(".json"));

// Забрать из облака новые и обновлённые проекты. Возвращает, сколько проектов изменилось на устройстве.
// Удалённый на устройстве проект сам не возвращается — только если чат пришлёт его новую версию.
export async function pullProjects(refresh = true) {
  if (!cloud.signedIn()) return 0;
  if (refresh) await cloud.refresh();
  let n = 0;
  for (const [pre, dir] of SOURCES) for (const f of await files(dir)) {
    const id = f.name.slice(0, -5);
    if (seen()[pre + id] === stamp(f)) continue;
    try {
      const p = JSON.parse(await cloud.getText(PATHS[dir], f.name)), local = await db.get("projects", id);
      if (p && p.id === id && (!local || (p.updated || 0) > (local.updated || 0))) { p.fresh = true; if (dir === "inbox") p.by = "claude"; await db.put("projects", p); n++; }
      mark(pre + id, stamp(f));
    } catch {}
  }
  return n;
}
// Сохранить версию владельца в облако (в свою папку; файл чата не трогается).
export async function pushProject(P) {
  if (!cloud.signedIn()) return;
  const { fresh, ...rest } = P;
  await cloud.putText(PATHS.projects, P.id + ".json", JSON.stringify({ ...rest, by: "app" }));
  const f = (await files("projects")).find((x) => x.name === P.id + ".json");
  if (f) mark(P.id, stamp(f));
}
// Удаление проекта на устройстве: убираем только свою копию из облака. Файл, который положил чат, остаётся.
export async function removeProject(id) { if (cloud.signedIn()) { try { await cloud.remove(PATHS.projects, id + ".json"); } catch {} } }
// Есть ли в облаке версия новее открытого проекта (чат прислал новую или правили на другом устройстве).
export async function remoteNewer(P) {
  if (!cloud.signedIn()) return null;
  await cloud.refresh();
  let best = null;
  for (const [pre, dir] of SOURCES) {
    const f = (await files(dir)).find((x) => x.name === P.id + ".json");
    if (!f || seen()[pre + P.id] === stamp(f)) continue;
    const p = JSON.parse(await cloud.getText(PATHS[dir], f.name));
    mark(pre + P.id, stamp(f));
    if (p && p.id === P.id && (p.updated || 0) > Math.max(P.updated || 0, best ? best.updated : 0)) { if (dir === "inbox") p.by = "claude"; best = p; }
  }
  return best;
}
