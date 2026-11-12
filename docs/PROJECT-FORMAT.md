# Проект монтажной программы — формат и мост с чатом Claude

Приложение владельца (https://kdyj8n8j9v-dot.github.io/capcut/) хранит каждый проект одним файлом JSON в MEGA:
`/10 бит/.studio/projects/<id>.json`. Этот же файл читает и пишет чат Claude («Монтаж»):

- чат кладёт проект → он появляется у владельца на главном экране с пометкой «новое из чата „Монтаж“»;
  если проект уже открыт — обновляется сам примерно за полминуты;
- владелец правит в приложении → правки ложатся в тот же файл (поле `by: "app"`), чат читает их командой `get`.

Побеждает версия с большим `updated` (миллисекунды). Перед тем как править проект владельца, всегда сначала `get`.

## Команды (из этого репозитория, нужны MEGAcmd и MEGA_EMAIL / MEGA_PASSWORD в окружении)

```
python3 scripts/project.py list                 # проекты в облаке
python3 scripts/project.py get <id|название>    # проект целиком — посмотреть, что изменил владелец
python3 scripts/project.py put spec.json        # собрать проект из короткого описания и положить
python3 scripts/project.py push project.json    # положить готовый проект (после get и правки)
```

Оригиналы должны лежать в MEGA «/Исходники». Чтобы у владельца было превью, для каждого файла один раз нужен
`prepare` (workflow `studio-worker`, вход `file` = имя файла) — он делает копию 1080p и слова речи в `/10 бит/.studio`.

## Короткое описание для `put`

```json
{
  "name": "Название ролика",
  "format": "9:16",
  "clips": [
    { "file": "имя оригинала.mov", "in": 12.4, "out": 18.9 },
    { "file": "имя оригинала.mov", "in": 31.0, "out": 40.2, "frame": { "scale": 1.2, "x": 0, "y": -0.05, "rot": 0 },
      "mask": { "shape": "ellipse", "w": 0.8, "h": 0.5, "feather": 0.1 } }
  ],
  "grade": { "exposure": 0.1, "contrast": 0.15, "saturation": 0.05 },
  "volume": 1,
  "subs": { "font": "Montserrat", "hl": "color", "hlColor": "#ffd60a", "in": "pop", "maxChars": 16 },
  "clouds": [ { "start": 0, "end": 6.5, "x": 0.5, "y": 0.72, "w": 0.8, "h": 0.16, "a": 0.6 } ]
}
```

- `format`: `9:16` (2160×3840), `16:9`, `1:1`, `4:5`. `in`/`out` — секунды в исходнике. Клипы идут подряд.
- `frame`: `scale` (1 = заполнить кадр), `x`/`y` — сдвиг в долях кадра, `rot` — градусы. Математика — `grade.py`.
- `grade`: ползунки −1…1, имена как в `grade.py` (`exposure`, `brightness`, `contrast`, `highlights`, `shadows`, `whites`,
  `blacks`, `temp`, `tint`, `saturation`, `vibrance`, `sharpness`, `clarity`, `vignette`, `skin_*`, `hsl`). Цвет общий на ролик.
- `subs`: `true` или настройки стиля (все ключи и значения по умолчанию — `SUB_DEFAULT` в `app/js/subs.mjs`;
  готовые наборы — `PRESETS` там же). Слова берутся из транскрипта файла в MEGA.
- `mask`: `shape` — `rect` | `ellipse` | `band` | `line`; `x`,`y`,`w`,`h` — доли кадра; `rot`, `feather`, `round`, `invert`.
- `clouds`: мягкое затемнение под текст; время в секундах ролика.

## Полный проект (то, что отдаёт `get`)

```
id, name, created, updated, by ("app" | "claude"), format, volume, duration
media:  { <ключ>: { name, dur, w, h } }            ключ = первые 16 знаков sha256 имени файла (NFC)
clips:  [ { id, media: <ключ>, in, out, frame?, mask? } ]
grade:  { … }
words:  { <ключ>: [ { text, start, end, em?, br?, nb?, ls?, ws? } ] }   слова во времени исходника
        em — ключевое слово; br — после слова новая строка; nb — не рвать; ls — свои настройки строки
        (в т.ч. layer, mv, ds, de); ws — свои настройки слова
subs:   { on, style }
clouds: [ { id, start, end, x, y, w, h, a, soft, color, fade } ]
```

Строки субтитров не хранятся — приложение собирает их из `words` и клипов на лету (`buildLines` в `app/js/subs.mjs`),
поэтому резка и перестановка клипов субтитры не ломают. Текст речи — личные данные владельца: в журналы и в git не писать.
