#!/usr/bin/env python3
"""Проекты монтажной программы в MEGA — мост между чатом Claude и приложением владельца.

Приложение (https://kdyj8n8j9v-dot.github.io/capcut/) держит проекты в MEGA «<OUT>/.studio/projects/<id>.json».
Всё, что сюда положено, появляется у владельца на главном экране («новое из чата „Монтаж“»), а открытый проект
обновляется сам за полминуты. Правки владельца ложатся в тот же файл — их можно прочитать командой get.

    python3 scripts/project.py list                 проекты в облаке: id, название, кто менял последним, когда
    python3 scripts/project.py get <id|название>    скачать проект (JSON в stdout) — посмотреть правки владельца
    python3 scripts/project.py put <spec.json>      собрать проект из короткого описания и положить в облако
    python3 scripts/project.py push <project.json>  положить готовый проект как есть (после get и правки)

Короткое описание (spec) — см. docs/PROJECT-FORMAT.md. Нужны MEGAcmd и вход (MEGA_EMAIL / MEGA_PASSWORD в окружении):
вход делает «bash scripts/cloud.sh status». Имена роликов и текст речи в журнал не печатаются.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONF = dict(l.strip().split("=", 1) for l in (ROOT / "cloud.conf").read_text().splitlines() if "=" in l and not l.startswith("#"))
IN, OUT = CONF["IN"].strip('"'), CONF["OUT"].strip('"')
STUDIO, PROJECTS = f"{OUT}/.studio", f"{OUT}/.studio/projects"
FORMATS = {"9:16", "16:9", "1:1", "4:5"}


def sh(*cmd, check=True):
    return subprocess.run(cmd, capture_output=True, text=True, check=check).stdout


def login():
    subprocess.run(["bash", str(ROOT / "scripts" / "cloud.sh"), "status"], capture_output=True, check=True)


def key_of(name):
    """Ключ файла в приложении: первые 16 знаков sha256 имени (как в worker/find.py)."""
    return hashlib.sha256(unicodedata.normalize("NFC", name).encode()).hexdigest()[:16]


def fetch(remote, suffix=""):
    """Скачать файл из MEGA во временную папку; None, если его нет."""
    d = tempfile.mkdtemp()
    if subprocess.run(["mega-get", remote, d + "/"], capture_output=True).returncode != 0:
        return None
    files = list(Path(d).iterdir())
    return files[0] if files else None


def remote_projects():
    out = []
    for line in sh("mega-ls", PROJECTS, check=False).splitlines():
        name = line.strip()
        if name.endswith(".json"):
            f = fetch(f"{PROJECTS}/{name}")
            if f:
                try:
                    out.append(json.loads(f.read_text()))
                except ValueError:
                    pass
    return out


def find(query):
    ps = remote_projects()
    q = unicodedata.normalize("NFC", query).casefold()
    hit = [p for p in ps if p.get("id") == query] or [p for p in ps if unicodedata.normalize("NFC", p.get("name", "")).casefold() == q] \
        or [p for p in ps if q in unicodedata.normalize("NFC", p.get("name", "")).casefold()]
    return max(hit, key=lambda p: p.get("updated", 0)) if hit else None


def probe(path):
    s = json.loads(sh("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                      "stream=width,height:stream_side_data=rotation:format=duration", "-of", "json", str(path)))
    st = s["streams"][0]
    w, h = st["width"], st["height"]
    rot = next((int(sd.get("rotation", 0) or 0) for sd in st.get("side_data_list", []) or [] if "rotation" in sd), 0)
    if abs(rot) in (90, 270):
        w, h = h, w
    return {"dur": round(float(s["format"]["duration"]), 3), "w": w, "h": h}


def media_info(name, given):
    """Длительность и размер кадра: из описания, из локального оригинала или из копии для превью в MEGA."""
    if given.get("dur"):
        return {"dur": float(given["dur"]), "w": int(given.get("w", 1920)), "h": int(given.get("h", 1080))}
    local = ROOT / "originals" / name
    if local.exists():
        return probe(local)
    proxy = fetch(f"{STUDIO}/{Path(name).stem}.proxy.mp4")
    if proxy:
        return probe(proxy)
    sys.exit("нет ни оригинала рядом, ни копии для превью в MEGA: сначала prepare (studio-worker) или укажите dur/w/h в описании")


def build(spec):
    """Короткое описание → проект в формате приложения."""
    if spec.get("format", "9:16") not in FORMATS:
        sys.exit("format: одно из " + ", ".join(sorted(FORMATS)))
    now = int(time.time() * 1000)
    uid = lambda i: f"c{now:x}{i:02d}"
    p = {"id": spec.get("id") or f"m{now:x}", "name": spec.get("name") or "Монтаж", "created": now, "updated": now, "by": "claude",
         "format": spec.get("format", "9:16"), "clips": [], "media": {}, "grade": spec.get("grade") or {}, "volume": spec.get("volume", 1),
         "words": {}, "clouds": []}
    for i, c in enumerate(spec["clips"]):
        name = unicodedata.normalize("NFC", c["file"])
        k = key_of(name)
        if k not in p["media"]:
            p["media"][k] = {"name": name, **media_info(name, c)}
        m = p["media"][k]
        clip = {"id": uid(i), "media": k, "in": float(c.get("in", 0)), "out": float(c.get("out", m["dur"]))}
        if not 0 <= clip["in"] < clip["out"] <= m["dur"] + 0.05:
            sys.exit(f"клип {i + 1}: in/out вне файла (длительность {m['dur']} с)")
        for extra in ("frame", "mask"):
            if c.get(extra):
                clip[extra] = c[extra]
        p["clips"].append(clip)
    if spec.get("subs"):
        for k, m in p["media"].items():
            t = fetch(f"{STUDIO}/{Path(m['name']).stem}.transcript.json")
            if t:
                p["words"][k] = [{"text": w["text"], "start": w["start"], "end": w["end"]} for w in json.loads(t.read_text()).get("words", [])]
        p["subs"] = {"on": True, "style": spec["subs"] if isinstance(spec["subs"], dict) else {}}
    for i, c in enumerate(spec.get("clouds") or []):
        p["clouds"].append({"id": f"k{now:x}{i:02d}", **c})
    p["duration"] = round(sum(c["out"] - c["in"] for c in p["clips"]), 3)
    return p


def upload(p):
    p["updated"] = int(time.time() * 1000)
    p["by"] = "claude"
    d = Path(tempfile.mkdtemp()) / f"{p['id']}.json"
    d.write_text(json.dumps(p, ensure_ascii=False))
    subprocess.run(["mega-mkdir", "-p", PROJECTS], capture_output=True)
    subprocess.run(["mega-rm", "-f", f"{PROJECTS}/{d.name}"], capture_output=True)
    subprocess.run(["mega-put", str(d), PROJECTS + "/"], capture_output=True, check=True)
    print(f"проект {p['id']} в облаке: клипов {len(p['clips'])}, длительность {p.get('duration', 0)} с — появится в приложении за полминуты")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("list", "get", "put", "push"):
        print(__doc__)
        return 2
    cmd = sys.argv[1]
    login()
    if cmd == "list":
        for p in sorted(remote_projects(), key=lambda p: -p.get("updated", 0)):
            who = "владелец (приложение)" if p.get("by") == "app" else "чат"
            print(f"{p['id']}\t{p.get('name', '')}\t{who}\t{time.strftime('%Y-%m-%d %H:%M', time.localtime(p.get('updated', 0) / 1000))}")
    elif cmd == "get":
        p = find(sys.argv[2])
        if not p:
            sys.exit("такого проекта в облаке нет")
        p.pop("thumb", None)
        print(json.dumps(p, ensure_ascii=False, indent=1))
    elif cmd == "put":
        upload(build(json.loads(Path(sys.argv[2]).read_text())))
    else:
        upload(json.loads(Path(sys.argv[2]).read_text()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
