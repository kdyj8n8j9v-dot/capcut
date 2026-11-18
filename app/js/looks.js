// Готовые цветовые пресеты: наборы ползунков «Цвета» (те же, что в grade.py). Сила 0..1 — доля от пресета.
export const LOOKS = [
  ["natural", "Как снято", {}],
  ["warm", "Тёплый", { temp: 0.35, saturation: 0.08, vibrance: 0.1 }],
  ["cool", "Холодный", { temp: -0.35, tint: 0.05, saturation: 0.05 }],
  ["vivid", "Сочный", { vibrance: 0.45, saturation: 0.15, contrast: 0.15, clarity: 0.15 }],
  ["cinema", "Кино", { contrast: 0.25, saturation: -0.1, temp: 0.1, highlights: -0.2, shadows: 0.1, vignette: -0.25, hsl: { orange: [0, 0.15, 0.05], aqua: [0.2, 0.2, 0], blue: [-0.2, 0.15, -0.1] } }],
  ["tealorange", "Бирюза и оранж", { contrast: 0.2, hsl: { orange: [0.05, 0.3, 0.05], yellow: [-0.2, 0, 0], green: [0.4, -0.2, 0], aqua: [0.1, 0.35, -0.05], blue: [-0.1, 0.3, -0.1] } }],
  ["drama", "Драма", { clarity: 0.45, contrast: 0.3, vignette: -0.4, saturation: -0.15, highlights: -0.25 }],
  ["soft", "Мягкий", { contrast: -0.2, highlights: -0.3, shadows: 0.25, saturation: -0.05, brightness: 0.05 }],
  ["portrait", "Портрет", { skin_smooth: 0.4, skin_tone: 0.3, brightness: 0.05, clarity: -0.1, vibrance: 0.1 }],
  ["fresh", "Свежий", { exposure: 0.1, vibrance: 0.3, temp: -0.05, hsl: { green: [0, 0.2, 0.1], blue: [0, 0.15, 0.05] } }],
  ["sunset", "Закат", { temp: 0.55, tint: 0.15, saturation: 0.15, highlights: -0.15 }],
  ["night", "Ночь", { temp: -0.4, exposure: -0.2, saturation: -0.15, contrast: 0.15 }],
  ["vintage", "Винтаж", { blacks: -0.35, contrast: -0.15, saturation: -0.25, temp: 0.2, tint: 0.1, vignette: -0.3 }],
  ["pastel", "Пастель", { blacks: -0.25, contrast: -0.3, saturation: -0.2, brightness: 0.15, vibrance: 0.1 }],
  ["bw", "Ч/Б", { saturation: -1, contrast: 0.15 }],
  ["bwhard", "Ч/Б жёсткий", { saturation: -1, contrast: 0.45, clarity: 0.3, blacks: 0.2 }],
];
export function scaleLook(g, k) {
  const out = {};
  for (const [key, v] of Object.entries(g || {})) {
    if (key === "hsl") { out.hsl = {}; for (const [b, a] of Object.entries(v)) out.hsl[b] = a.map((x) => x * k); }
    else out[key] = v * k;
  }
  return out;
}
