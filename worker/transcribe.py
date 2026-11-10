#!/usr/bin/env python3
"""Local word-level transcription with faster-whisper, in the kit's common format.

Usage:
    python3 scripts/transcribe-whisper.py <media> [--model large-v3-turbo] [--language ru] [-o out.json]

Writes <media stem>.transcript.json next to the input (unless -o is given):
    {"text": ..., "audio_duration_secs": ..., "language": ..., "words": [{"text", "start", "end"}]}
Times are seconds on the source recording's timeline. No cloud calls: the model
is downloaded once from Hugging Face and cached locally.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return round(float(out), 3)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("media", type=Path)
    ap.add_argument("--model", default="large-v3-turbo",
                    help="faster-whisper model: tiny, base, small, medium, large-v3, large-v3-turbo (default)")
    ap.add_argument("--language", default=None, help="language code, e.g. ru or en; auto-detected if omitted")
    ap.add_argument("-o", "--output", type=Path, default=None)
    args = ap.parse_args()

    if not args.media.exists():
        print(f"not found: {args.media}", file=sys.stderr)
        return 2

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    # decode with ffmpeg (16 kHz mono float) so faster-whisper never needs PyAV, whose API changes break it
    import numpy as np
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(args.media), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, dtype=np.float32)
    segments, info = model.transcribe(
        audio,
        language=args.language,
        word_timestamps=True,
        vad_filter=False,  # keep real pauses on the source timeline for cut-silences
        beam_size=5,
    )

    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"text": text, "start": round(w.start, 3), "end": round(w.end, 3)})
        print(f"[{seg.start:7.2f} → {seg.end:7.2f}] {seg.text.strip()}", file=sys.stderr)

    result = {
        "text": " ".join(w["text"] for w in words),
        "audio_duration_secs": probe_duration(args.media),
        "language": info.language,
        "words": words,
    }
    out = args.output or args.media.with_suffix(".transcript.json")
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out} ({len(words)} words, language={info.language})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
