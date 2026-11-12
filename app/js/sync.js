// Проекты в MEGA («10 бит/.studio/projects»): общие для всех устройств владельца и для чата «Монтаж»,
// который кладёт туда собранные проекты и читает правки владельца (scripts/project.py, docs/PROJECT-FORMAT.md).
import { db, settings } from "./store.js";
import { cloud, PATHS } from "./cloud.js";

const stamp = (f) => f.ts + ":" + f.size;
const seen = () => settings.get("psync") || {};
const mark = (id, st) => settings.set("psync", { ...seen(), [id]: st });

// Забрать из облака новые и обновлённые проекты. Возвращает, сколько проектов изменилось на устройстве.
export async function pullProjects(refresh = true) {
  if (!cloud.signedIn()) return 0;
  if (refresh) await cloud.refresh();
  const list = (await cloud.list(PATHS.projects) || []).filter((f) => !f.dir && f.name.endsWith(".json"));
  let n = 0;
  for (const f of list) {
    const id = f.name.slice(0, -5);
    if (seen()[id] === stamp(f)) continue;
    try {
      const p = JSON.parse(await cloud.getText(PATHS.projects, f.name)), local = await db.get("projects", id);
      if (p && p.id === id && (!local || (p.updated || 0) > (local.updated || 0))) { if (p.by !== "app") p.fresh = true; await db.put("projects", p); n++; }
      mark(id, stamp(f));
    } catch {}
  }
  return n;
}
// Положить проект в облако.
export async function pushProject(P) {
  if (!cloud.signedIn()) return;
  const { fresh, ...rest } = P;
  await cloud.putText(PATHS.projects, P.id + ".json", JSON.stringify({ ...rest, by: "app" }));
  const f = (await cloud.list(PATHS.projects) || []).find((x) => x.name === P.id + ".json");
  if (f) mark(P.id, stamp(f));
}
export async function removeProject(id) { if (cloud.signedIn()) { try { await cloud.remove(PATHS.projects, id + ".json"); } catch {} } }
// Есть ли в облаке версия новее открытого проекта (её положил чат «Монтаж» или другое устройство).
export async function remoteNewer(P) {
  if (!cloud.signedIn()) return null;
  await cloud.refresh();
  const f = (await cloud.list(PATHS.projects) || []).find((x) => x.name === P.id + ".json");
  if (!f || seen()[P.id] === stamp(f)) return null;
  const p = JSON.parse(await cloud.getText(PATHS.projects, f.name));
  mark(P.id, stamp(f));
  return p && p.id === P.id && (p.updated || 0) > (P.updated || 0) ? p : null;
}
