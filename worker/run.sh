#!/bin/bash
# Облачный исполнитель «Студии» на GitHub Actions — работает без Claude.
#   bash worker/run.sh prepare <файл в IN>     → прокси 1080p H.264 + субтитры (слова) → MEGA OUT/.studio/
#   bash worker/run.sh export  <project.json>  → H.265 10 бит 4:2:2 из оригиналов → MEGA OUT
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
    arg=$(bash scripts/cloud.sh list | python3 -c 'import json,sys
q=sys.argv[1].strip().lower(); n=[json.loads(l)["name"] for l in sys.stdin if l.strip()]
m=[x for x in n if x.lower()==q] or [x for x in n if x.lower().rsplit(".",1)[0]==q] or [x for x in n if x.lower().startswith(q)] or [x for x in n if q in x.lower()]
print(m[0] if m else "")' "$arg")
    [ -n "$arg" ] || { echo "в MEGA «Исходники» нет такого файла" >&2; exit 1; }
    echo "::add-mask::$arg"; echo "::add-mask::${arg%.*}"   # репозиторий публичный: имя ролика в журнале скрыто
    bash scripts/cloud.sh pull "$arg"
    src="originals/$arg"; [ -f "$src" ] || { echo "нет 10 бит 4:2:2 оригинала: $arg" >&2; exit 1; }
    stem="${arg%.*}"; mkdir -p work
    # прокси для монтажа на iPad: 1080 по короткой стороне, H.264 High, ключевой кадр каждые 0,5 с (точная перемотка)
    ffmpeg -v error -y -i "$src" -vf "scale='if(gt(iw,ih),-2,1080)':'if(gt(iw,ih),1080,-2)':flags=bicubic,format=yuv420p" \
      -c:v libx264 -preset fast -crf 20 -g 15 -c:a aac -b:a 160k -movflags +faststart "work/$stem.proxy.mp4"
    python3 worker/transcribe.py "$src" --language ru -o "work/$stem.transcript.json"
    mega_up "work/$stem.proxy.mp4" "$STUDIO"
    mega_up "work/$stem.transcript.json" "$STUDIO" ;;
  export)
    files=$(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));u={s["clip"] for s in p["timeline"]};print("\n".join(p["clips"][k]["file"] for k in u))' "$arg")
    while IFS= read -r f; do bash scripts/cloud.sh pull "$f"; done <<< "$files"
    name=$(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));print((p.get("name") or p.get("id") or "edit").replace("/","-"))' "$arg")
    python3 render.py "$arg" --out "work/$name-10bit.mov"
    bash scripts/cloud.sh put "work/$name-10bit.mov" ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
