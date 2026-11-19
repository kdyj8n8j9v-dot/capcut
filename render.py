#!/usr/bin/env python3
"""Render an editor project from the 10-bit camera originals to H.265 10-bit 4:2:2.

    python3 render.py <project.json> [--out file.mov] [--still SECONDS out.png] [--draft]

project.json = the editor's project document (see README.md). Each clip's `file` names the
original in originals/ (fetched from MEGA «Исходники» with `bash scripts/cloud.sh pull`). Processing is float32
from rgb48 (16-bit) decode; the encoder gets rgb48 and writes yuv422p10le, Main 4:2:2 10, BT.709.
--draft: 1/2 size, fast preset (checks only, never delivered).
"""
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import grade as G  # noqa: E402

ROOT = Path(__file__).resolve().parent
ORIG = ROOT / "originals"
FADE = 0.012  # s, audio fade at every join


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate,pix_fmt,profile,color_space,color_transfer,color_primaries:stream_side_data=rotation",
                          "-of", "json", str(path)], capture_output=True, text=True, check=True)
    s = json.loads(out.stdout)["streams"][0]
    rot = 0
    for sd in s.get("side_data_list", []) or []:
        rot = int(sd.get("rotation", 0) or 0)
    w, h = s["width"], s["height"]
    if rot in (90, -90, 270, -270):
        w, h = h, w
    return {"w": w, "h": h, "fps": Fraction(s["r_frame_rate"]), "pix_fmt": s.get("pix_fmt"),
            "trc": s.get("color_transfer")}


def clip_path(clip):
    p = Path(clip["file"])
    return p if p.is_absolute() else ORIG / p


def decode(path, t0, dur, w, h, fps=None, speed=1.0, count=None):
    """Yield float32 HxWx3 frames (0..1) of [t0, t0+dur) of the source — rgb48 decode, BT.709 limited → full.
    fps: the output rate, given only for a take shot at another rate (frames are dropped/repeated to match).
    speed ≠ 1 (the app's clip speed): source time is squeezed/stretched, then sampled at fps (needs fps)."""
    vf = "scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb48le"
    pre = f"setpts=(PTS-STARTPTS)/{speed:.6f},fps={fps}," if speed != 1 else (f"fps={fps}," if fps else "")
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.6f}", "-i", str(path), "-t", f"{dur:.6f}", "-an",
           "-vf", pre + vf, *(["-frames:v", str(count)] if count else []), "-f", "rawvideo", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = w * h * 3 * 2
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, "<u2").reshape(h, w, 3).astype(np.float32) / 65535.0
    p.wait()


def has_audio(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout.strip()
    return bool(out)


def spd(s):
    return float(s.get("speed") or 1)


def seg_len(s):
    """Length of a segment on the timeline (the source part played at its speed or along its speed curve)."""
    if s.get("map"):
        return float(s["map"][-1][1])
    return (s["out"] - s["in"]) / spd(s)


def map_src(m, out_t):
    """Speed curve (the app's speed.mjs curveMap: [[source s, timeline s], …] from the segment start): timeline → source."""
    if out_t <= m[0][1]:
        return m[0][0]
    for (s0, o0), (s1, o1) in zip(m, m[1:]):
        if out_t <= o1:
            return s0 + (s1 - s0) * (out_t - o0) / max(1e-12, o1 - o0)
    return m[-1][0]


def curve_frames(src, m, n, fps, src_fps):
    """n output frames along a speed curve: source frames are taken (repeated or skipped) at mapped times."""
    cur, idx = None, -1
    for k in range(n):
        want = int(map_src(m, (k + 0.5) / fps) * src_fps)
        while idx < want:
            nxt = next(src, None)
            if nxt is None:
                break
            cur, idx = nxt, idx + 1
        if cur is not None:
            yield cur


def atempo(speed):
    """atempo takes 0.5…2 per filter: chain them for 0.25…4."""
    out, k = [], speed
    while k > 2:
        out.append("atempo=2"); k /= 2
    while k < 0.5:
        out.append("atempo=0.5"); k /= 0.5
    out.append(f"atempo={k:.6f}")
    return ",".join(out)


def total_len(segs):
    """the film's length: dissolves (xfade) overlap a take and the next one"""
    return sum(seg_len(s) for s in segs) - sum(float(s.get("xfade") or 0) for s in segs[:-1])


def noise_floor(wav):
    """Noise floor of the joined track in dBFS: the 10th percentile of 50 ms RMS windows (pauses between words)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-f", "f32le", "-ac", "1", "-ar", "48000", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    n = len(x) // 2400
    if n < 4:
        return -60.0
    r = np.sqrt(np.mean(x[: n * 2400].reshape(n, 2400) ** 2, axis=1)) + 1e-9
    return float(np.clip(20 * np.log10(np.percentile(r, 10)), -80, -20))


def audio_params(a):
    """Sound settings with defaults; an old project's single «Улучшить голос» (voice) becomes the separate controls."""
    a = dict(a or {})
    vc = float(a.get("voice") or 0)
    if vc > 0 and "comp" not in a:
        a.update(rumble=(20 + 40 * vc) / 80, mud=vc / 2, pres=0.667 * vc, air=0.333 * vc, comp=vc)
    if a.get("normalize") and not a.get("lufs"):
        a["lufs"] = -14
    for k in ("rumble", "denoise", "deess", "body", "mud", "pres", "air", "comp", "leveler", "fade_in", "fade_out"):
        a[k] = float(a.get(k) or 0)
    a["dehum"] = int(a.get("dehum") or 0)
    a["lufs"] = float(a.get("lufs") or 0)
    return a


def audio_chain(a, T, nf=-60.0):
    """«Звук» tab, the same chain the preview runs in Web Audio (app.html audioOn). Order as in Adobe Audition's
    Essential Sound → Dialogue and Auphonic: Repair (rumble, hum, noise, sibilance) → Clarity (EQ, compressor) →
    Leveler (phrase levels; pauses and noise are not lifted) → Loudness target → volume, fades, limiter."""
    a = audio_params(a)
    vol = 0.0 if a.get("mute") else float(a.get("volume", 1.0))
    f = ["aformat=sample_fmts=fltp:sample_rates=48000"]
    if a["rumble"] > 0:
        f.append(f"highpass=f={40 + 80 * a['rumble']:.0f}:p=2")
    if a["dehum"] in (50, 60):
        f += [f"equalizer=f={a['dehum'] * k}:t=q:w=12:g=-24" for k in (1, 2, 3)]
    if a["denoise"] > 0:
        # floor measured on this track; afftdn accepts −80…−20 dB only (a noisy take measured −21 dB → −18 failed the export)
        f.append(f"afftdn=nr={6 + 24 * a['denoise']:.1f}:nf={max(-80.0, min(-20.0, nf + 3)):.1f}")
    if a["deess"] > 0:
        f.append(f"deesser=i={a['deess']:.2f}:m=0.5:f=0.5")
    if a["body"]:
        f.append(f"lowshelf=f=150:g={6 * a['body']:.2f}")
    if a["mud"] > 0:
        f.append(f"equalizer=f=300:t=q:w=1:g={-6 * a['mud']:.2f}")
    if a["pres"]:
        f.append(f"equalizer=f=3000:t=q:w=0.9:g={6 * a['pres']:.2f}")
    if a["air"]:
        f.append(f"highshelf=f=10000:g={6 * a['air']:.2f}")
    if a["comp"] > 0:
        c = a["comp"]
        f.append(f"acompressor=threshold={10 ** ((-18 - 6 * c) / 20):.4f}:ratio={1 + 3 * c:.2f}:attack=10:release=120")
        vol *= voice_makeup(c)
    if a["leveler"] > 0:  # Auphonic-style leveler: lifts quiet phrases up to +12·l dB, frames below the noise gate stay
        thr = min(0.5, 10 ** ((nf + 6) / 20))  # 6 dB above the noise floor: pauses are not lifted
        f.append(f"dynaudnorm=f=250:g=7:p=0.9:m={10 ** (12 * a['leveler'] / 20):.2f}:t={thr:.5f}")  # ~1.75 s window, ≤ +12 dB
    if a["lufs"] < 0:
        f.append(f"loudnorm=I={a['lufs']:.0f}:TP=-1.5:LRA=11")
    f.append(f"volume={vol:.4f}")
    if a["fade_in"] > 0:
        f.append(f"afade=t=in:st=0:d={min(a['fade_in'], T):.3f}")
    if a["fade_out"] > 0:
        f.append(f"afade=t=out:st={max(0, T - a['fade_out']):.3f}:d={min(a['fade_out'], T):.3f}")
    if vol > 1 or a["comp"] > 0 or a["leveler"] > 0 or a["lufs"] < 0 or a["body"] > 0 or a["pres"] > 0 or a["air"] > 0:
        f.append("alimiter=limit=0.97:level=false")
    return ",".join(f)


def voice_makeup(c):
    """Gain back what the voice compressor takes from speech at about −12 dBFS (same formula as app.html fadeTick)."""
    thr, ratio = -18 - 6 * c, 1 + 3 * c
    return 10 ** (((-12 - thr) * (1 - 1 / ratio)) / 20)


def build_audio(project, out_wav):
    segs, inputs, parts = project["timeline"], [], []
    clips = project["clips"]
    vol = 1.0  # per segment: unity; volume, fades and the voice chain run once on the joined track (audio_chain)
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    for i, s in enumerate(segs):
        path = clip_path(clips[s["clip"]])
        inputs += ["-i", str(path)]
        d = seg_len(s)
        if has_audio(path) and s.get("map"):   # speed curve: short pieces, each at its own tempo, joined
            m, k = s["map"], 12
            step = max(1, (len(m) - 1) // k)
            pts = m[::step] if m[::step][-1] == m[-1] else m[::step] + [m[-1]]
            pieces = []
            for j, ((s0, o0), (s1, o1)) in enumerate(zip(pts, pts[1:])):
                if o1 - o0 < 1e-3:
                    continue
                tempo = max(0.1, min(10.0, (s1 - s0) / (o1 - o0)))
                parts.append(f"[{i}:a]atrim={s['in'] + s0:.6f}:{s['in'] + s1:.6f},asetpts=PTS-STARTPTS,{fmt},{atempo(tempo)}[c{i}_{j}]")
                pieces.append(f"[c{i}_{j}]")
            parts.append("".join(pieces) + f"concat=n={len(pieces)}:v=0:a=1,atrim=0:{d:.6f},apad=whole_dur={d:.6f},"
                         f"afade=t=in:d={FADE},afade=t=out:st={max(0, d - FADE):.6f}:d={FADE}[a{i}]")
        elif has_audio(path):
            parts.append(f"[{i}:a]atrim={s['in']:.6f}:{s['out']:.6f},asetpts=PTS-STARTPTS,{fmt},"
                         + (atempo(spd(s)) + "," if spd(s) != 1 else "") +
                         f"afade=t=in:d={FADE},afade=t=out:st={max(0, d - FADE):.6f}:d={FADE},volume={vol:.4f}[a{i}]")
        else:  # take without sound (screen recording, drone): silence of the same length
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{d:.6f},{fmt}[a{i}]")
    # takes joined one by one: a dissolve (xfade) crossfades the sound over its length, a plain cut just follows
    chain = "[a0]"
    for i in range(1, len(segs)):
        x = float(segs[i - 1].get("xfade") or 0)
        parts.append(f"{chain}[a{i}]" + (f"acrossfade=d={x:.6f}:c1=tri:c2=tri" if x > 0 else "concat=n=2:v=0:a=1") + f"[j{i}]")
        chain = f"[j{i}]"
    fc = ";".join(parts) + (f";{chain}anull[a]" if len(segs) > 1 else ";[a0]anull[a]")
    joined = Path(out_wav).with_suffix(".joined.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[a]",
                    "-c:a", "pcm_f32le", "-ar", "48000", str(joined)], check=True)
    a = project.get("audio") or {}
    ap = audio_params(a)
    nf = noise_floor(joined) if (ap["denoise"] or ap["leveler"]) else -60.0
    sounds = [x for x in project.get("sounds") or [] if x.get("file") and Path(x["file"]).exists()]
    voice = Path(out_wav).with_suffix(".voice.wav") if sounds else Path(out_wav)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(joined), "-af", audio_chain(a, total_len(segs), nf),
                    "-c:a", "pcm_s24le", "-ar", "48000", str(voice)], check=True)
    joined.unlink(missing_ok=True)
    if sounds:
        mix_sounds(voice, sounds, total_len(segs), out_wav)
        voice.unlink(missing_ok=True)


def mix_sounds(voice, sounds, T, out_wav):
    """Music and sound effects on top of the voice track (the app's «Звук» → sounds). Each sound: its part of the file
    (from, start..end on the timeline), volume, fades; «duck» lowers it under the voice (sidechain compressor)."""
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    inputs, parts, mix = ["-i", str(voice)], [f"[0:a]{fmt},asplit=2[v][sc0]"], ["[v]"]
    ducked = [i for i, x in enumerate(sounds) if x.get("duck")]
    if len(ducked) > 1:   # the voice feeds every ducked sound: split it once per sound
        parts[0] = f"[0:a]{fmt},asplit={len(ducked) + 1}[v]" + "".join(f"[sc{k}]" for k in range(len(ducked)))
    elif not ducked:
        parts[0] = f"[0:a]{fmt}[v]"
    for i, x in enumerate(sounds, 1):
        start, end = max(0.0, float(x["start"])), min(T, float(x["end"]))
        d = end - start
        if d <= 0.01:
            continue
        inputs += ["-ss", f"{float(x.get('from') or 0):.6f}", "-t", f"{d:.6f}", "-i", str(x["file"])]
        vol = 0.0 if x.get("mute") else float(x.get("volume", 1))
        fi, fo = min(float(x.get("fadeIn") or 0), d), min(float(x.get("fadeOut") or 0), d)
        chain = f"[{i}:a]{fmt},volume={vol:.4f}"
        if fi > 0:
            chain += f",afade=t=in:st=0:d={fi:.3f}"
        if fo > 0:
            chain += f",afade=t=out:st={max(0, d - fo):.3f}:d={fo:.3f}"
        chain += f",adelay={int(round(start * 1000))}:all=1,apad=whole_dur={T:.6f}"
        if x.get("duck"):
            k = ducked.index(i - 1)
            chain += f"[m{i}];[m{i}][sc{k}]sidechaincompress=threshold=0.02:ratio=8:attack=30:release=400:makeup=1"
        parts.append(chain + f"[s{i}]")
        mix.append(f"[s{i}]")
    fc = ";".join(parts) + ";" + "".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=first,atrim=0:{T:.6f},alimiter=limit=0.97:level=false[a]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[a]",
                    "-c:a", "pcm_s24le", "-ar", "48000", str(out_wav)], check=True)


def output_size(project, info):
    o = project.get("output") or {}
    if o.get("w") and o.get("h"):
        return int(o["w"]), int(o["h"])
    w, h = info["w"], info["h"]
    if h >= w:  # vertical source: keep its own size
        return w, h
    return 2160, 3840  # landscape source → 9:16 at 4K height


def key_frame(keys, t):
    """keyframes of the take's frame (app/js/keys.mjs): [[seconds from the take's start, scale, x, y, rot], …], smoothstep between"""
    names = ("scale", "x", "y", "rot")
    if t <= keys[0][0]:
        return dict(zip(names, keys[0][1:]))
    for a, b in zip(keys, keys[1:]):
        if t <= b[0]:
            u = (t - a[0]) / max(1e-6, b[0] - a[0])
            e = u * u * (3 - 2 * u)
            return {n: a[i + 1] + (b[i + 1] - a[i + 1]) * e for i, n in enumerate(names)}
    return dict(zip(names, keys[-1][1:]))


def process(frame, project, seg, out_w, out_h, uv, own=False, t=0.0):
    """Frame → detail → vignette (here); the colour steps run in the encoder as the baked LUT.
    own: some take has its own colour (seg["grade"]) — then the colour steps run here too, per take, and the encoder has no LUT."""
    g = G.settings(seg.get("grade") or project.get("grade"))
    fr = {**(project.get("frame") or {}), **(seg.get("frame") or {})}
    if seg.get("keys"):   # keyframes: the frame moves (zoom, pan, turn) along the take
        fr.update(key_frame(seg["keys"], t))
    framed = G.apply_frame(frame, fr, out_w, out_h)
    img = G.vignette(np.clip(G.detail(framed, g), 0, 1), g, uv)
    return G.color(img, g) if own else img


def render(project, out, draft=False):
    clips = project["clips"]
    segs = project["timeline"]
    # only the takes the timeline uses: a take added and cut out again may have no original in MEGA any more
    infos = {k: probe(clip_path(clips[k])) for k in dict.fromkeys(s["clip"] for s in segs)}
    first = infos[segs[0]["clip"]]
    fps = first["fps"]
    out_w, out_h = output_size(project, first)
    if draft:
        out_w, out_h = out_w // 2 // 2 * 2, out_h // 2 // 2 * 2
    uv = G.uv_grid(out_w, out_h)
    work = ROOT / "work" / project.get("id", "project")
    work.mkdir(parents=True, exist_ok=True)
    wav, cube = work / "audio.wav", work / "grade.cube"
    build_audio(project, wav)
    G.write_cube(G.settings(project.get("grade")), cube)
    # dissolve: the last k frames of a take are blended with the first k of the next — the film is k frames shorter
    xk = [round(float(s.get("xfade") or 0) * fps) if i < len(segs) - 1 else 0 for i, s in enumerate(segs)]
    total = sum(round(seg_len(s) * fps) for s in segs) - sum(xk)
    own = any(s.get("grade") for s in segs)   # a take with its own colour: colour per frame in process(), no LUT in the encoder
    vf = ("" if own else f"lut3d=file='{cube}':interp=tetrahedral,") + "scale=in_range=pc:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv422p10le"
    sub_in, vmap = [], ["-map", "0:v", "-vf", vf]
    layer = dict(project.get("subs") or {})
    ovs = []
    for o in project.get("overlays") or []:   # overlays: photos, stickers, videos on top — drawn by the app's own code too
        o = dict(o)
        if o.get("kind") == "video":
            path = clip_path(clips[o["clip"]])
            info = probe(path)
            o.update(src=str(path), w=info["w"], h=info["h"])
        if o.get("kind") == "image" and not o.get("file"):
            continue
        ovs.append(o)
    if ovs:
        layer["overlays"] = ovs
    if layer.get("lines") or layer.get("clouds") or layer.get("masks") or layer.get("overlays") or layer.get("transitions"):
        # subtitles: the app's own drawing code renders a transparent strip (worker/subs.mjs); it is laid over the graded
        # picture already in 10-bit 4:2:2, so the grade never touches the text and the video stays 10-bit
        sub = work / "subs.mov"
        pj = work / "subs.json"
        pj.write_text(json.dumps({"subs": {"style": {}, **layer}}, ensure_ascii=False))
        r = subprocess.run(["node", str(ROOT / "worker" / "subs.mjs"), str(pj), str(sub), f"{fps.numerator}/{fps.denominator}",
                            str(out_w), str(out_h), str(total)], capture_output=True, text=True, check=True)
        band = json.loads(r.stdout.strip().splitlines()[-1])
        sub_in = ["-i", str(sub)]
        vmap = ["-filter_complex", f"[0:v]{vf}[v];[2:v]scale=in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuva422p10le[s];"
                                   f"[v][s]overlay=0:{band['y']}:format=yuv422p10:eof_action=pass[o]", "-map", "[o]"]
    enc = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{out_w}x{out_h}",
           "-r", str(fps), "-i", "-", "-i", str(wav), *sub_in, *vmap, "-map", "1:a",
           "-c:v", "libx265", "-profile:v", "main422-10", "-preset", "ultrafast" if draft else "medium",
           "-crf", "24" if draft else "12", "-x265-params", "log-level=error",
           "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
           "-tag:v", "hvc1", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", str(out)]
    p = subprocess.Popen(enc, stdin=subprocess.PIPE)
    done, t_start = 0, time.time()
    prog = work / "progress.json"
    tail = []   # processed last frames of the previous take, waiting for a dissolve (float16 to save memory)
    with ThreadPoolExecutor(3) as pool:
        for si, seg in enumerate(segs):
            info = infos[seg["clip"]]
            k_in, k_out = (xk[si - 1] if si else 0), xk[si]
            n = round(seg_len(seg) * fps)
            if seg.get("map"):   # speed curve: native source frames, picked along the curve
                src = curve_frames(decode(clip_path(clips[seg["clip"]]), seg["in"], seg["out"] - seg["in"], info["w"], info["h"]),
                                   seg["map"], n, float(fps), float(info["fps"]))
                src = exactly(src, n)
            else:
                src = decode(clip_path(clips[seg["clip"]]), seg["in"], n / fps * spd(seg), info["w"], info["h"],
                             fps if (info["fps"] != fps or spd(seg) != 1) else None, spd(seg), n if spd(seg) != 1 else None)
                if spd(seg) != 1:
                    src = exactly(src, n)
            if draft:
                src = (f[::2, ::2] for f in src)
            pending, j, new_tail = [], 0, []

            def emit(img):
                nonlocal_j = emit.j
                emit.j += 1
                if nonlocal_j < k_in and nonlocal_j < len(tail):   # dissolve in: mix with the previous take's tail
                    w = (nonlocal_j + 0.5) / k_in
                    img = tail[nonlocal_j].astype(np.float32) * (1 - w) + img * w
                if k_out and nonlocal_j >= n - k_out:              # dissolve out: keep for the next take
                    new_tail.append(img.astype(np.float16))
                    return 0
                return write(p, img)
            emit.j = 0
            for fi, frame in enumerate(src):
                pending.append(pool.submit(process, frame, project, seg, out_w, out_h, uv, own, fi / float(fps)))
                if len(pending) >= 6:
                    done += emit(pending.pop(0).result())
                    if done % 50 == 0:  # progress inside a long segment too (one-take projects jumped 0 → 100 %)
                        prog.write_text(json.dumps({"done": done, "total": total, "elapsed": round(time.time() - t_start)}))
            for f in pending:
                done += emit(f.result())
            tail = new_tail
            prog.write_text(json.dumps({"done": done, "total": total, "elapsed": round(time.time() - t_start)}))
    p.stdin.close()
    if p.wait() != 0:
        raise SystemExit("encoder failed")
    return verify(out, out_w, out_h, float(total / fps))


def exactly(src, n):
    """n frames: a sped-up/slowed part can come one or two frames short at its end — the last one is held."""
    last = None
    for i, f in enumerate(src):
        if i >= n:
            break
        last = f
        yield f
    else:
        i = (i + 1) if last is not None else 0
        while last is not None and i < n:
            yield last
            i += 1


def write(p, img):
    p.stdin.write((np.clip(img, 0, 1) * 65535 + 0.5).astype("<u2").tobytes())
    return 1


def verify(out, w, h, dur):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "stream=codec_name,profile,pix_fmt,width,height,color_space:format=duration",
                        "-of", "json", str(out)], capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    v = next(s for s in d["streams"] if s["codec_name"] == "hevc")
    ok = v["pix_fmt"] == "yuv422p10le" and v["width"] == w and v["height"] == h \
        and abs(float(d["format"]["duration"]) - dur) < 0.15
    report = {"ok": ok, "pix_fmt": v["pix_fmt"], "profile": v.get("profile"), "size": f"{v['width']}x{v['height']}",
              "duration": round(float(d["format"]["duration"]), 2), "expected": round(dur, 2),
              "bytes": Path(out).stat().st_size}
    print(json.dumps(report, ensure_ascii=False))
    return report


def still(project, t, png):
    """One graded frame at timeline time t (seconds) → 16-bit PNG, for comparison with the app."""
    acc = 0.0
    for seg in project["timeline"]:
        d = seg_len(seg)
        if t < acc + d:
            break
        acc += d
    clip = project["clips"][seg["clip"]]
    info = probe(clip_path(clip))
    out_w, out_h = output_size(project, info)
    at = map_src(seg["map"], t - acc) if seg.get("map") else (t - acc) * spd(seg)
    frame = next(decode(clip_path(clip), seg["in"] + at, 1 / float(info["fps"]), info["w"], info["h"]))
    img = process(frame, project, seg, out_w, out_h, G.uv_grid(out_w, out_h))
    cube = Path(png).with_suffix(".cube")
    G.write_cube(G.settings(project.get("grade")), cube)
    raw = (np.clip(img, 0, 1) * 65535 + 0.5).astype("<u2").tobytes()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", f"{out_w}x{out_h}",
                    "-i", "-", "-vf", f"lut3d=file='{cube}':interp=tetrahedral", "-pix_fmt", "rgb48be", str(png)],
                   input=raw, check=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--out")
    ap.add_argument("--still", nargs=2, metavar=("SECONDS", "PNG"))
    ap.add_argument("--draft", action="store_true")
    a = ap.parse_args()
    proj = json.loads(Path(a.project).read_text())
    if a.still:
        still(proj, float(a.still[0]), a.still[1])
    else:
        name = (proj.get("name") or proj.get("id") or "edit").replace("/", "-")
        out = Path(a.out) if a.out else ROOT / "work" / f"{name}-10bit.mov"
        rep = render(proj, out, a.draft)
        sys.exit(0 if rep["ok"] else 1)
