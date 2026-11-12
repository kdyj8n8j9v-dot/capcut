#!/bin/bash
# Облачный исполнитель «Студии» на GitHub Actions — работает без Claude.
#   bash worker/run.sh prepare <файл в IN>     → прокси 1080p H.264 + субтитры (слова) → MEGA OUT/.studio/
#   bash worker/run.sh export  <номер задания>  → проект из MEGA OUT/.studio/jobs → H.265 10 бит 4:2:2 из оригиналов → MEGA OUT
# MEGA_EMAIL / MEGA_PASSWORD — секреты репозитория (Settings → Secrets → Actions), не в git.
set -euo pipefail
cd "$(dirname "$0")/.."
. ./cloud.conf
job=$1; arg=$2
STUDIO="$OUT/.studio"
mega_up() { mega-mkdir -p "$2" 2>/dev/null || true; mega-put -c "$1" "$2/" >/dev/null; echo "  ✓ $(basename "$1") → $2"; }

case "$job" in
  prepare)
    # имя можно дать без расширения или началом: ищем в IN (без учёта регистра)
    q="$arg"
    arg=$(bash scripts/cloud.sh list | python3 worker/find.py "$q")
    if [ -z "$arg" ]; then
      echo "в MEGA «$IN» нет файла с таким именем (видео в папке: $(bash scripts/cloud.sh list | wc -l))" >&2
      # подсказка без имён (журнал публичный): в каких папках MEGA лежит похожее имя и с каким расширением
      w=$(python3 -c 'import sys;print(max(sys.argv[1].split(),key=len))' "$q")
      mega-find / --pattern="*$w*" 2>/dev/null | python3 -c 'import sys,os
for l in sys.stdin:
    l=l.strip()
    if l: print("  похожее имя есть в папке:", os.path.dirname(l) or "/", "· расширение:", os.path.splitext(l)[1] or "нет")' >&2 || true
      exit 1
    fi
    echo "::add-mask::$arg"; echo "::add-mask::${arg%.*}"   # репозиторий публичный: имя ролика в журнале скрыто
    ANY_SOURCE=1 bash scripts/cloud.sh pull "$arg"
    src="originals/$arg"; [ -f "$src" ] || { echo "файл не скачался или это не видео" >&2; exit 1; }
    stem="${arg%.*}"; mkdir -p work
    # прокси для монтажа на iPad: 1080 по короткой стороне, H.264 High, ключевой кадр каждые 0,5 с (точная перемотка)
    ffmpeg -v error -y -i "$src" -vf "scale='if(gt(iw,ih),-2,1080)':'if(gt(iw,ih),1080,-2)':flags=bicubic,format=yuv420p" \
      -c:v libx264 -preset fast -crf 20 -g 15 -c:a aac -b:a 160k -movflags +faststart "work/$stem.proxy.mp4"
    # текст речи в журнал не пишем (репозиторий публичный)
    python3 worker/transcribe.py "$src" --language ru -o "work/$stem.transcript.json" 2> work/transcribe.log \
      || { echo "распознавание речи не удалось: $(tail -1 work/transcribe.log)" >&2; exit 1; }
    echo "  ✓ субтитры: $(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))["words"]))' "work/$stem.transcript.json") слов"
    mega_up "work/$stem.proxy.mp4" "$STUDIO"
    mega_up "work/$stem.transcript.json" "$STUDIO" ;;
  export)
    # $arg — номер задания: проект лежит в MEGA «$STUDIO/jobs/<номер>.json» (в GitHub не передаётся: репозиторий публичный).
    # «selftest» — проверка сборки без приложения: 2 секунды первого файла из IN, итог никуда не загружается.
    req="$arg"; mkdir -p work
    bash scripts/cloud.sh status >/dev/null
    if [ "$req" = selftest ]; then
      first=$(bash scripts/cloud.sh list | python3 worker/find.py "*"); [ -n "$first" ] || { echo "в «$IN» нет видео" >&2; exit 1; }
      echo "::add-mask::$first"; echo "::add-mask::${first%.*}"
      python3 - "$first" > work/project.json <<'PY'
import json, sys
print(json.dumps({"id": "selftest", "name": "selftest", "output": {"w": 2160, "h": 3840}, "clips": {"a": {"file": sys.argv[1]}},
                  "timeline": [{"clip": "a", "in": 1.0, "out": 2.0, "frame": {"scale": 1.2, "rot": 3}}, {"clip": "a", "in": 3.0, "out": 4.0}],
                  "grade": {"exposure": 0.2, "contrast": 0.2, "clarity": 0.3, "vignette": -0.3, "saturation": 0.1}, "audio": {"volume": 1},
                  "subs": {"style": {"in": "letters", "hl": "fill", "glow": 0.4}, "masks": [{"shape": "ellipse", "w": 0.95, "h": 0.8, "feather": 0.1, "start": 0, "end": 1}], "clouds": [{"start": 0.2, "end": 1.8, "x": 0.5, "y": 0.72, "w": 0.9, "h": 0.2, "a": 0.6}], "lines": [{"start": 0.1, "end": 1.9, "words": [{"text": "Проверка", "start": 0.1, "end": 0.9}, {"text": "субтитров", "start": 0.9, "end": 1.8}]}]}}, ensure_ascii=False))
PY
    else
      case "$req" in *[!A-Za-z0-9]*|"") echo "плохой номер задания" >&2; exit 2 ;; esac
      mega-get "$STUDIO/jobs/$req.json" work/project.in.json >/dev/null
      # имена файлов в проекте — «#хеш»: находим настоящие имена в IN
      bash scripts/cloud.sh list > work/list.jsonl
      python3 - work/project.in.json work/list.jsonl "$req" > work/project.json <<'PY'
import json, subprocess, sys
p = json.load(open(sys.argv[1])); lst = open(sys.argv[2]).read()
for k, c in p["clips"].items():
    name = subprocess.run([sys.executable, "worker/find.py", c["file"]], input=lst, capture_output=True, text=True).stdout.strip()
    if not name:
        sys.exit("в MEGA «Исходники» нет одного из оригиналов проекта")
    c["file"] = name
# свои шрифты субтитров — из MEGA «Для монтажа ПАК» (путь приходит из приложения; берём только оттуда)
import os
for i, f in enumerate((p.get("subs") or {}).get("fonts") or []):
    path = f.get("path", "")
    if not path.startswith("Для монтажа ПАК/") or ".." in path or os.path.splitext(path)[1].lower() not in (".ttf", ".otf"):
        continue
    os.makedirs("work/fonts", exist_ok=True)
    local = os.path.abspath(f"work/fonts/{i}{os.path.splitext(path)[1].lower()}")
    if subprocess.run(["mega-get", "/" + path, local], capture_output=True).returncode == 0 and os.path.exists(local):
        f["file"] = local
    else:
        print("свой шрифт не скачался — будет запасной", file=sys.stderr)
p["id"] = sys.argv[3]
print(json.dumps(p, ensure_ascii=False))
PY
    fi
    name=$(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));print((p.get("name") or p.get("id") or "edit").replace("/","-"))' work/project.json)
    echo "::add-mask::$name"
    files=$(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));u={s["clip"] for s in p["timeline"]};print("\n".join(p["clips"][k]["file"] for k in u))' work/project.json)
    while IFS= read -r f; do echo "::add-mask::$f"; echo "::add-mask::${f%.*}"; ANY_SOURCE=1 bash scripts/cloud.sh pull "$f" </dev/null; [ -f "originals/$f" ] || { echo "оригинал не скачался" >&2; exit 1; }; done <<< "$files"
    # ход сборки → MEGA (приложение показывает проценты)
    if [ "$req" != selftest ]; then
      ( while sleep 30; do
          p="work/$req/progress.json"; [ -f "$p" ] || continue
          cp "$p" "work/$req.progress.json"; mega-rm -f "$STUDIO/jobs/$req.progress.json" >/dev/null 2>&1 || true
          mega-put "work/$req.progress.json" "$STUDIO/jobs/" >/dev/null 2>&1 || true
        done ) & watcher=$!
      trap 'kill $watcher 2>/dev/null || true' EXIT
    fi
    python3 render.py work/project.json --out "work/$name-10bit.mov"
    if [ "$req" = selftest ]; then echo "  ✓ проверка сборки прошла: $(cat work/selftest/progress.json)"; exit 0; fi
    kill $watcher 2>/dev/null || true
    bash scripts/cloud.sh put "work/$name-10bit.mov"
    mega-rm -f "$STUDIO/jobs/$req.json" "$STUDIO/jobs/$req.progress.json" >/dev/null 2>&1 || true ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
