// Быстрое воспроизведение (как в Kapwing, Descript, Clipchamp): кадры декодирует видеочип через WebCodecs
// (библиотека mediabunny), а показываем их по часам таймлайна — сами, без встроенного видеоплеера браузера.
// Плеер браузера на ускорении и кривых скорости не успевал: кадры скакали, звук рвался. Здесь скорость влияет
// только на то, какой кадр взять; звук играет отдельный элемент <audio> (тон сохраняется).
// В картинку перерисовывается только тот кадр, который показывается; пропущенные на ускорении сразу освобождаются.
// Если браузер не умеет WebCodecs или этот кодек — возвращаем null, и работает прежний путь.
import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from "../vendor/mediabunny.mjs";

const QUEUE = 4;   // сколько декодированных кадров держим наготове

export async function openFast(blob) {
  if (typeof VideoDecoder === "undefined" || !blob) return null;
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const W = track.displayWidth, H = track.displayHeight, k = Math.min(1, 1280 / Math.max(W, H));
    const w = Math.max(2, Math.round(W * k / 2) * 2), h = Math.max(2, Math.round(H * k / 2) * 2);
    const sink = new VideoSampleSink(track);
    const off = await track.getFirstTimestamp().catch(() => 0) || 0;
    const audio = !!(await input.getPrimaryAudioTrack().catch(() => null));
    return { input, sink, w, h, off, audio };
  } catch { return null; }
}

// Поток кадров клипа с секунды исходника start: декодер работает впереди (до QUEUE кадров), frameAt(src) отдаёт
// последний кадр не позже src. Поток можно создать заранее, на паузе («подготовить»), — тогда пуск без задержки.
export class Stream {
  constructor(f, start) {
    this.f = f; this.start = start; this.q = []; this.cur = null; this.done = false; this.alive = true; this.busy = false;
    this.cv = document.createElement("canvas"); this.cv.width = f.w; this.cv.height = f.h;
    this.g = this.cv.getContext("2d", { alpha: false });
    this.it = f.sink.samples(Math.max(0, start + f.off));
    this.pump();
  }
  async pump() {
    if (this.busy || !this.alive) return;
    this.busy = true;
    try {
      while (this.alive && !this.done && this.q.length < QUEUE) {
        const r = await this.it.next();
        if (r.done) { this.done = true; break; }
        if (!this.alive) { r.value.close(); break; }
        this.q.push(r.value);
      }
    } catch (e) { this.done = true; this.err = "декодер: " + (e?.message || e); }
    this.busy = false;
  }
  frameAt(src) {
    const s = src + this.f.off + 0.002;
    let pick = null;
    while (this.q.length && this.q[0].timestamp <= s) { if (pick) pick.close(); pick = this.q.shift(); }
    if (pick) {   // перерисовать только показываемый кадр (уменьшенным до размера превью)
      try { pick.drawWithFit(this.g, { fit: "fill" }); this.cur = { canvas: this.cv, timestamp: pick.timestamp }; }
      catch (e) {   // запасной способ нарисовать кадр (если этот браузер не умеет первый)
        try { const vf = pick.toVideoFrame(); this.g.drawImage(vf, 0, 0, this.cv.width, this.cv.height); vf.close(); this.cur = { canvas: this.cv, timestamp: pick.timestamp }; }
        catch (e2) { this.err = "рисование: " + (e?.message || e); }
      }
      pick.close();
    }
    this.pump();
    return this.cur;
  }
  ready(src) { return !!this.cur || (this.q.length > 0 && this.q[0].timestamp <= src + this.f.off + 0.05); }
  stop() {
    this.alive = false;
    for (const x of this.q) x.close();
    this.q = [];
    try { this.it.return(); } catch {}
  }
}
