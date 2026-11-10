"""Colour and frame math of the 10-bit editor.

The same steps, in the same order and with the same constants, live in the GLSL shader of
app.html (function `grade`). Change both together and run `python3 test_match.py`.

All values are display-referred Rec.709 in 0..1, float32. Settings come from the project
document (see README.md); every slider is -1..1 with 0 = no change unless noted.
"""
import math

import cv2
import numpy as np

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# HSL bands: centre hue in degrees (red, orange, yellow, green, aqua, blue, purple, magenta)
HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]
HSL_CENTRES = [0, 30, 60, 120, 180, 220, 270, 320]
HSL_WIDTH = 45.0  # degrees, triangular falloff
CLARITY_SIGMA = 0.012  # of frame height
SHARP_SIGMA = 1 / 1600  # of frame height

DEFAULT = {
    "exposure": 0, "brightness": 0, "contrast": 0, "highlights": 0, "shadows": 0,
    "whites": 0, "blacks": 0, "temp": 0, "tint": 0, "saturation": 0, "vibrance": 0,
    "sharpness": 0, "clarity": 0, "vignette": 0, "vig_mid": 0.5, "vig_feather": 0.5,
    "skin_smooth": 0, "skin_tone": 0, "skin_sat": 0, "skin_light": 0,
    "hsl": {b: [0, 0, 0] for b in HSL_BANDS},
}


def settings(g):
    s = {**DEFAULT, **(g or {})}
    s["hsl"] = {**DEFAULT["hsl"], **((g or {}).get("hsl") or {})}
    return s


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def luma(c):
    return c[..., 0] * LUMA[0] + c[..., 1] * LUMA[1] + c[..., 2] * LUMA[2]


def rgb_to_hsv(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    de = np.where(d > 1e-6, d, 1.0)
    h = np.where(mx == r, ((g - b) / de) % 6, np.where(mx == g, (b - r) / de + 2, (r - g) / de + 4)) / 6.0
    h = np.where(d > 1e-6, h, 0.0)
    s = np.where(mx > 1e-6, d / np.where(mx > 1e-6, mx, 1.0), 0.0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    k = lambda n: (n + h * 6.0) % 6.0
    f = lambda n: v - v * s * np.clip(np.minimum(k(n), 4.0 - k(n)), 0.0, 1.0)
    return np.stack([f(5.0), f(3.0), f(1.0)], -1)


SKIN_HUE = 25.0  # degrees: the target skin hue the «Выравнивание» slider pulls towards


def skin_mask(h, s, v):
    """0..1 weight of skin-like pixels: hue near SKIN_HUE, moderate saturation, not too dark."""
    d = np.abs(((h * 360 - SKIN_HUE + 180) % 360) - 180)
    return ((1 - smoothstep(15.0, 40.0, d)) * smoothstep(0.08, 0.2, s) * (1 - smoothstep(0.65, 0.85, s))
            * smoothstep(0.12, 0.3, v)).astype(np.float32)


def blur_large(y, h):
    """Clarity base: 1/8 area downscale, gaussian, bilinear back up (same as the shader passes)."""
    H, W = y.shape
    small = cv2.resize(y, (max(1, W // 8), max(1, H // 8)), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), CLARITY_SIGMA * h / 8)
    return cv2.resize(small, (W, H), interpolation=cv2.INTER_LINEAR)


def detail(c, g):
    """Step 1 — clarity (large radius, midtones) and sharpness (small radius) on the framed image."""
    if not (g["clarity"] or g["sharpness"] or g["skin_smooth"]):
        return c
    H = c.shape[0]
    y0 = luma(c)
    add = np.zeros_like(y0)
    yb = blur_large(y0, H) if (g["clarity"] or g["skin_smooth"]) else None
    if g["clarity"]:
        m = np.clip(4 * y0 * (1 - y0), 0, 1)
        add += g["clarity"] * 0.8 * (y0 - yb) * m
    if g["skin_smooth"]:  # skin only: pull luma towards the large blur (softens texture, keeps colour)
        add -= g["skin_smooth"] * 0.9 * (y0 - yb) * skin_mask(*rgb_to_hsv(np.clip(c, 0, 1)))
    if g["sharpness"]:
        ys = cv2.GaussianBlur(y0, (0, 0), SHARP_SIGMA * H)
        add += g["sharpness"] * 2.0 * np.clip(y0 - ys, -0.08, 0.08)
    return c + add[..., None]


def vignette(c, g, uv):
    """Step 2 — radial darken (<0) / lighten (>0), before the colour steps."""
    if not g["vignette"]:
        return c
    H, W = c.shape[:2]
    key = (W, H, g["vignette"], g["vig_mid"], g["vig_feather"])
    if _VIG.get("key") != key:
        r = vignette_r(uv if uv is not None else uv_grid(W, H), W / H)
        mid = g["vig_mid"]
        vv = smoothstep(mid, mid + 0.05 + 0.6 * g["vig_feather"], r)
        _VIG.update(key=key, mask=(1 + g["vignette"] * 0.85 * vv).astype(np.float32)[..., None])
    return c * _VIG["mask"]


_VIG = {}


def color(c, g):
    """Steps 3–10 — per-pixel colour (baked into a 3D LUT for rendering). c: ...x3 in 0..1."""
    c = np.clip(c, 0, 1).astype(np.float32)
    # 3. white balance + exposure in linear light
    lin = np.power(c, 2.2)
    gain = np.array([1 + 0.3 * g["temp"], 1 - 0.2 * g["tint"], 1 - 0.3 * g["temp"]], np.float32)
    gain /= float(gain @ LUMA)
    lin = lin * gain * np.float32(2.0 ** g["exposure"])
    c = np.power(lin, 1 / 2.2)
    # 4. whites / blacks (levels)
    b0, w0 = -0.10 * g["blacks"], 1 - 0.15 * g["whites"]
    c = (c - b0) / (w0 - b0)
    # 5. shadows / highlights
    y = np.clip(luma(c), 0, 1)
    ws = (1 - smoothstep(0.0, 0.6, y)) ** 2
    wh = smoothstep(0.4, 1.0, y) ** 2
    c = c * (1 + g["shadows"] * 0.6 * ws + g["highlights"] * 0.5 * wh)[..., None]
    # 6. brightness (midtones)
    c = np.power(np.clip(c, 0, 1), 2.0 ** (-g["brightness"] * 0.8))
    # 7. contrast (smooth S-curve up, flatten down)
    k = g["contrast"]
    if k >= 0:
        c = c + (c * c * (3 - 2 * c) - c) * k
    else:
        c = c + ((0.5 + (c - 0.5) * 0.4) - c) * (-k)
    # 8. saturation / vibrance
    y = luma(c)[..., None]
    chroma = (c.max(-1) - c.min(-1))[..., None]
    s = (1 + g["saturation"]) * (1 + g["vibrance"] * (1 - np.clip(chroma * 2, 0, 1)))
    c = np.clip(y + (c - y) * s, 0, 1)
    # 9. HSL bands
    hsl = [g["hsl"][b] for b in HSL_BANDS]
    if any(any(v) for v in hsl):
        h, sat, v = rgb_to_hsv(c)
        cw = smoothstep(0.05, 0.25, sat)
        dh = np.zeros_like(h); ds = np.zeros_like(h); dl = np.zeros_like(h)
        for (bh, bs, bl), centre in zip(hsl, HSL_CENTRES):
            d = np.abs(((h * 360 - centre + 180) % 360) - 180)
            w = np.maximum(0, 1 - d / HSL_WIDTH)
            dh += w * bh; ds += w * bs; dl += w * bl
        h = (h + dh * cw * (30 / 360)) % 1.0
        sat = np.clip(sat * (1 + ds * cw), 0, 1)
        v = np.clip(v * (1 + dl * 0.5 * cw), 0, 1)
        c = hsv_to_rgb(h, sat, v)
    # 10. skin: even out the hue towards SKIN_HUE, skin saturation and lightness
    if g["skin_tone"] or g["skin_sat"] or g["skin_light"]:
        h, sat, v = rgb_to_hsv(c)
        m = skin_mask(h, sat, v)
        dh = ((SKIN_HUE / 360 - h + 0.5) % 1.0) - 0.5
        h = (h + dh * g["skin_tone"] * 0.6 * m) % 1.0
        sat = np.clip(sat * (1 + 0.5 * g["skin_sat"] * m), 0, 1)
        v = np.clip(v * (1 + 0.3 * g["skin_light"] * m), 0, 1)
        c = hsv_to_rgb(h, sat, v)
    return np.clip(c, 0, 1)


def grade(c, g, uv=None):
    """Full chain on a framed HxWx3 image (reference; rendering bakes `color` into a LUT)."""
    return color(vignette(np.clip(detail(c.astype(np.float32), g), 0, 1), g, uv), g)


def write_cube(g, path, n=65):
    """Bake steps 3–10 into an n³ .cube LUT (red fastest, as the format requires)."""
    x = np.linspace(0, 1, n, dtype=np.float32)
    b, gg, r = np.meshgrid(x, x, x, indexing="ij")
    rgb = np.stack([r, gg, b], -1).reshape(-1, 3)
    out = color(rgb, g)
    with open(path, "w") as f:
        f.write(f"LUT_3D_SIZE {n}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n")
        np.savetxt(f, out, fmt="%.6f")


def uv_grid(W, H):
    x = (np.arange(W, dtype=np.float32) + 0.5) / W
    y = (np.arange(H, dtype=np.float32) + 0.5) / H
    return np.stack(np.meshgrid(x, y), -1)


def vignette_r(uv, aspect):
    p = (uv - 0.5) * np.array([aspect, 1], np.float32)
    return np.linalg.norm(p, axis=-1) / (0.5 * math.hypot(aspect, 1))


def frame_matrix(fr, src_w, src_h, out_w, out_h):
    """2x3 matrix mapping OUTPUT pixel centres to SOURCE pixel coords (cv2 WARP_INVERSE_MAP).

    fr: {"scale": >=1, "x": -1..1, "y": -1..1 (offset in output widths/heights), "rot": degrees}.
    Base fit = cover (the source fills the output frame).
    """
    cover = max(out_w / src_w, out_h / src_h)
    s = cover * float(fr.get("scale", 1) or 1)
    th = math.radians(float(fr.get("rot", 0) or 0))
    ox, oy = float(fr.get("x", 0) or 0) * out_w, float(fr.get("y", 0) or 0) * out_h
    cos, sin = math.cos(-th), math.sin(-th)
    # q = R(-th) * ((p + 0.5) - out/2 - off) / s ; src_px = q + src/2 - 0.5
    a = np.array([[cos, -sin], [sin, cos]]) / s
    t = a @ np.array([0.5 - out_w / 2 - ox, 0.5 - out_h / 2 - oy]) + np.array([src_w / 2 - 0.5, src_h / 2 - 0.5])
    return np.hstack([a, t[:, None]]).astype(np.float64)


def apply_frame(img, fr, out_w, out_h):
    m = frame_matrix(fr, img.shape[1], img.shape[0], out_w, out_h)
    return cv2.warpAffine(img, m, (out_w, out_h), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
