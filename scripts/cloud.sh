#!/bin/bash
# MEGA for «Студия 10 бит»: camera originals in, finished 10-bit exports out.
#
#   bash scripts/cloud.sh status            login state + both folders
#   bash scripts/cloud.sh folders           MEGA account tree (to pick paths for cloud.conf)
#   bash scripts/cloud.sh pull [file...]    originals from IN → originals/; keeps only 10-bit 4:2:2 (ffprobe),
#                                           the rest is deleted and listed in originals/.not-10bit-422 (not fetched again)
#   bash scripts/cloud.sh list              videos in IN as JSON lines {name, size, date, not10bit} (nothing is downloaded)
#   bash scripts/cloud.sh put <file>...     finished export (H.265 10-bit 4:2:2) → OUT, size checked
#
# Secrets live only in the environment settings (never chat, never git):
#   MEGA_EMAIL, MEGA_PASSWORD   — MEGA account that owns (or has write access to) the folders, no 2FA
# Folder paths (not secret) live in cloud.conf: IN (originals), OUT (results).
set -euo pipefail
cd "$(dirname "$0")/.."
CONF="cloud.conf"
[ -f "$CONF" ] && . "$CONF"
cmd=${1:-status}; shift || true
need_mega() {
  [ -n "${MEGA_EMAIL:-}" ] && [ -n "${MEGA_PASSWORD:-}" ] || { echo "нет MEGA_EMAIL / MEGA_PASSWORD в окружении (новая сессия подхватывает их при старте)" >&2; exit 1; }
  if ! command -v mega-put >/dev/null; then
    . /etc/os-release
    deb=$(mktemp --suffix=.deb)
    curl -sSfL -o "$deb" "https://mega.nz/linux/repo/xUbuntu_${VERSION_ID}/amd64/megacmd-xUbuntu_${VERSION_ID}_amd64.deb"
    apt-get install -y -qq "$deb" >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq "$deb" >/dev/null; }
  fi
  # After a container restart the server resumes the saved session before it knows the proxy and hangs
  # («Command not valid while login in»): restart it without that session; the login below runs again.
  if timeout 30 mega-whoami 2>&1 | grep -q 'while login in'; then
    pkill -f '[m]ega-cmd-server' || true; sleep 2
    rm -f "$HOME/.megaCmd/session"
  fi
  [ -n "${HTTPS_PROXY:-}" ] && mega-proxy "$HTTPS_PROXY" >/dev/null
  mega-https on >/dev/null
  if ! mega-whoami 2>/dev/null | grep -qi "$MEGA_EMAIL"; then
    mega-logout >/dev/null 2>&1 || true
    mega-login "$MEGA_EMAIL" "$MEGA_PASSWORD" >/dev/null
  fi
}

need_path() {  # $1 = variable name in cloud.conf
  local v="${!1:-}"
  [ -n "$v" ] || { echo "в $CONF не задан $1 (посмотри «bash scripts/cloud.sh folders»)" >&2; exit 1; }
  mega-ls "$v" >/dev/null 2>&1 || { echo "MEGA: папка «$v» ($1) не найдена или нет доступа" >&2; exit 1; }
}

case "$cmd" in
  folders)
    need_mega; mega-ls -R --tree / 2>/dev/null | grep -v "^\s*$" | head -200 ;;
  status)
    need_mega; echo "MEGA: вошли как $(mega-whoami | sed 's/.*: //')"
    for v in IN OUT; do
      p="${!v:-}"; if [ -z "$p" ]; then echo "  $v: не задан в $CONF"; elif mega-ls "$p" >/dev/null 2>&1; then echo "  $v = $p: ok, файлов $(mega-ls -l "$p" | awk 'NR>1 && $1 ~ /^-/' | wc -l)"; else echo "  $v = $p: НЕТ ДОСТУПА"; fi
    done ;;
  pull)     # no args: every new file of IN; with args: only these names. Each file is checked right
                   # after download: only 10-bit 4:2:2 (pix_fmt yuv422p10*) stays, the rest is deleted and remembered
    need_mega; need_path IN
    dest="originals"; skip="$dest/.not-10bit-422"; mkdir -p "$dest"; touch "$skip"
    ok=0; bad=0; badlist=""
    if [ $# -eq 0 ]; then list=$(mega-ls -l "$IN" | awk 'NR>1 && $1 ~ /^-/ {size=$3; $1=$2=$3=$4=$5=""; sub(/^ +/,""); print size "\t" $0}')
    else list=$(for n in "$@"; do printf '%s\t%s\n' "?" "$n"; done); fi
    while IFS=$'\t' read -r size name; do
      [ -n "$name" ] || continue
      case "${name,,}" in *.mov|*.mp4|*.m4v|*.mxf) ;; *) continue ;; esac
      if [ $# -eq 0 ] && grep -qxF "$name"$'\t'"$size" "$skip"; then continue; fi  # already rejected, same file
      if [ -f "$dest/$name" ] && { [ "$size" = "?" ] || [ "$(stat -c %s "$dest/$name")" = "$size" ]; }; then echo "  есть: $name"
      else echo "  скачиваю: $name"; mega-get "$IN/$name" "$dest/" >/dev/null </dev/null; fi
      fmt=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,codec_name,profile -of csv=p=0 "$dest/$name" 2>/dev/null | head -1)
      case "$fmt" in
        *yuv422p10*) echo "  ✓ 10 бит 4:2:2 ($fmt)"; ok=$((ok+1)) ;;
        ?*) if [ -n "${ANY_SOURCE:-}" ]; then echo "  ✓ принят ($fmt): итог всё равно 10 бит 4:2:2"; ok=$((ok+1)); continue; fi ;;&
        *) echo "  ✗ не 10 бит 4:2:2 (${fmt:-не видео}) — пропущен"; rm -f "$dest/$name"
           rs=$(mega-ls -l "$IN" </dev/null | awk -v n="$name" 'index($0, n) {print $3}' | head -1)
           grep -qxF "$name"$'\t'"$rs" "$skip" || printf '%s\t%s\n' "$name" "$rs" >> "$skip"
           bad=$((bad+1)); badlist="$badlist $name" ;;
      esac
    done <<< "$list"
    echo "10 бит 4:2:2: $ok · не подходит: $bad${badlist:+ —$badlist}" ;;
  list)     # what can be picked in the editor: videos in IN (date as mega-ls prints it); nothing is downloaded
    need_mega; need_path IN
    skip="originals/.not-10bit-422"; mkdir -p originals; touch "$skip"
    mega-ls -l "$IN" | awk 'NR>1 && $1 ~ /^-/ {size=$3; d=$4 " " $5; $1=$2=$3=$4=$5=""; sub(/^ +/,""); print size "\t" d "\t" $0}' |
    while IFS=$'\t' read -r size d name; do
      case "${name,,}" in *.mov|*.mp4|*.m4v|*.mxf) ;; *) continue ;; esac
      bad=false; grep -qxF "$name"$'\t'"$size" "$skip" && bad=true
      python3 -c 'import json,sys;print(json.dumps({"name":sys.argv[1],"size":int(sys.argv[2]),"date":sys.argv[3],"not10bit":sys.argv[4]=="true"},ensure_ascii=False))' "$name" "$size" "$d" "$bad"
    done ;;
  put)
    [ $# -ge 1 ] || { echo "usage: scripts/cloud.sh put <file>..." >&2; exit 2; }
    need_mega; need_path OUT
    for f in "$@"; do
      name=$(basename "$f"); size=$(stat -c %s "$f")
      echo "загрузка: $name ($((size / 1000000)) МБ) → $OUT"
      mega-put "$f" "$OUT/" >/dev/null
      remote=$(mega-ls -l "$OUT" | awk -v n="$name" 'index($0, n) {print $3}' | head -1)
      [ "$remote" = "$size" ] && echo "  ✓ в папке, размер совпадает" || { echo "  ✗ размер не совпал (локально $size, в MEGA ${remote:-нет})" >&2; exit 1; }
    done ;;
  *) sed -n 2,15p "$0"; exit 2 ;;
esac
