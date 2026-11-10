@NOW.md

# Монтажная программа (как CapCut, без Claude)

Отдельная программа владельца: монтаж на iPad/iPhone, сборка в H.265 10 бит 4:2:2 4K на GitHub Actions.
Репозиторий публичный: никаких паролей, ключей, токенов, личных данных и видео в git.

- План, устройство, этапы — `docs/STUDIO-PLAN.md`.
- Приложение — `app/` (публикуется на GitHub Pages через `.github/workflows/pages.yml`).
- Исполнитель — `.github/workflows/studio-worker.yml`, `worker/run.sh` (prepare, export), MEGA — `scripts/cloud.sh`, `cloud.conf`.
- Цвет и кадр — `grade.py`, сборка — `render.py` (копии из «Студии 10 бит»; редактор `10-bit` отсюда не менять).
- Владелец пишет по-русски, работает с iPad; интерфейс и документация на русском; ответы коротко.
