import sharp from "sharp";

/**
 * Photosensitivity check (WCAG 2.3.1 "Three Flashes or Below Threshold") on captured screen frames.
 *
 * - A general flash is a pair of opposing changes in relative luminance of at least 0.1 where the darker state
 *   is below 0.8; a red flash is a pair of opposing changes of at least 20 in (R − G − B) × 320 involving
 *   saturated red (R / (R + G + B) ≥ 0.8). More than three of either in any one second fails.
 * - Only flashes covering at least 25 % of a 10° visual field at the same time count. Held at about 30 cm, 10° is
 *   about 52 mm, some 320 CSS px of a phone screen, so the frame is split into 10 px cells, and a field (every
 *   320 px square, in 80 px steps) makes a transition on a frame where a quarter of its cells turn the same way
 *   together (a checkerboard flipping counts: half its cells brighten at once). Two halves that turn the same way
 *   a frame apart count as one. Moving objects don't count: they darken the cells they enter and brighten the
 *   ones they leave on every frame, never a quarter of a field in one direction.
 * - Each cell's signal is tracked as a zig-zag: a change only counts once the signal has turned back by the
 *   threshold, so slow fades and sensor-level noise don't add up to flashes.
 */

export const MAX_FLASHES_PER_SECOND = 3;
const CELL_CSS = 10;
const FIELD_CELLS = 32;
const STRIDE_CELLS = 8;
const AREA = 0.25;
const LUM_STEP = 0.1;
const LUM_DARK = 0.8;
const RED_STEP = 20;

const LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Per-cell zig-zag tracker; emits each completed leg (a transition) at the frame it peaked. */
class Zigzag {
  private readonly dir: Int8Array;
  private readonly ref: Float32Array;
  private readonly ext: Float32Array;
  private readonly extF: Int32Array;
  private readonly lo: Float32Array;
  private readonly hi: Float32Array;
  private readonly seen: Uint8Array;

  constructor(
    readonly n: number,
    private readonly step: number,
    private readonly darkBelow: number | null,
    private readonly emit: (cell: number, frame: number, up: boolean) => void,
  ) {
    this.dir = new Int8Array(n);
    this.ref = new Float32Array(n);
    this.ext = new Float32Array(n);
    this.extF = new Int32Array(n);
    this.lo = new Float32Array(n);
    this.hi = new Float32Array(n);
    this.seen = new Uint8Array(n);
  }

  update(i: number, v: number, frame: number): void {
    if (!this.seen[i]) {
      this.seen[i] = 1;
      this.lo[i] = this.hi[i] = this.ref[i] = this.ext[i] = v;
      this.extF[i] = frame;
      return;
    }
    const d = this.dir[i]!;
    if (d === 0) {
      if (v < this.lo[i]!) this.lo[i] = v;
      if (v > this.hi[i]!) this.hi[i] = v;
      if (v - this.lo[i]! >= this.step) this.start(i, 1, this.lo[i]!, v, frame);
      else if (this.hi[i]! - v >= this.step) this.start(i, -1, this.hi[i]!, v, frame);
    } else if (d > 0 ? v > this.ext[i]! : v < this.ext[i]!) {
      this.ext[i] = v;
      this.extF[i] = frame;
    } else if (Math.abs(this.ext[i]! - v) >= this.step) {
      this.leg(i);
      this.start(i, -d, this.ext[i]!, v, frame);
    }
  }

  /** Emits every open leg and forgets all state (between capture segments). */
  cut(): void {
    for (let i = 0; i < this.n; i++) if (this.dir[i] !== 0) this.leg(i);
    this.dir.fill(0);
    this.seen.fill(0);
  }

  private start(i: number, d: number, ref: number, v: number, frame: number): void {
    this.dir[i] = d;
    this.ref[i] = ref;
    this.ext[i] = v;
    this.extF[i] = frame;
  }

  private leg(i: number): void {
    const a = this.ref[i]!;
    const b = this.ext[i]!;
    if (Math.abs(b - a) >= this.step && (this.darkBelow === null || Math.min(a, b) < this.darkBelow)) this.emit(i, this.extF[i]!, b > a);
  }
}

/** Growable list of transitions: frame index and signed cell (cell + 1 brighter, -(cell + 1) darker). */
class Events {
  frame = new Int32Array(4096);
  cell = new Int32Array(4096);
  length = 0;
  push(frame: number, cell: number, up: boolean): void {
    if (this.length === this.frame.length) {
      const grow = (a: Int32Array) => {
        const b = new Int32Array(a.length * 2);
        b.set(a);
        return b;
      };
      this.frame = grow(this.frame);
      this.cell = grow(this.cell);
    }
    this.frame[this.length] = frame;
    this.cell[this.length] = up ? cell + 1 : -(cell + 1);
    this.length++;
  }
}

export interface FlashWorst {
  kind: "general" | "red";
  flashes: number;
  /** Capture segment (0 = the first) and seconds into it. */
  segment: number;
  at: number;
  /** The 10° field, in CSS px. */
  x: number;
  y: number;
  size: number;
}

export interface FlashResult {
  /** Most general flashes in any one second, in any field. */
  general: number;
  /** Most red flashes in any one second, in any field. */
  red: number;
  frames: number;
  seconds: number;
  worst: FlashWorst | null;
}

export class FlashMeter {
  private cols = 0;
  private rows = 0;
  private cellPx = 0;
  private lum: Zigzag | null = null;
  private redz: Zigzag | null = null;
  private readonly general = new Events();
  private readonly red = new Events();
  private readonly times: number[] = [];
  /** Segment of each frame, and when each segment started (shifted time). */
  private readonly segs: number[] = [];
  private readonly segStart: number[] = [];
  private seconds = 0;
  /** Added to capture times so a new segment starts well clear (2 s) of the last one. */
  private shift = 0;
  private gap = false;
  private queue: Promise<void> = Promise.resolve();

  /** `cssWidth`: the captured page's width in CSS px (frames may be scaled down). */
  constructor(private readonly cssWidth: number) {}

  /** Queues a PNG/JPEG frame captured at `t` seconds. */
  push(image: Buffer, t: number): void {
    this.queue = this.queue.then(async () => {
      try {
        const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        this.addRaw(data, info.width, info.height, info.channels, t);
      } catch {
        // An undecodable frame is skipped; the check reports how many frames it saw.
      }
    });
  }

  /** Adds a decoded frame (8-bit RGB or RGBA rows). */
  addRaw(data: Uint8Array, width: number, height: number, channels: number, t: number): void {
    if (!this.lum) {
      this.cols = Math.max(1, Math.floor(this.cssWidth / CELL_CSS));
      this.cellPx = width / this.cols;
      this.rows = Math.max(1, Math.floor(height / this.cellPx));
      const n = this.cols * this.rows;
      this.lum = new Zigzag(n, LUM_STEP, LUM_DARK, (c, f, up) => this.general.push(f, c, up));
      this.redz = new Zigzag(n, RED_STEP, null, (c, f, up) => this.red.push(f, c, up));
    }
    const { cols, rows, cellPx } = this;
    const n = cols * rows;
    const sumY = new Float32Array(n);
    const sumR = new Float32Array(n);
    const sumG = new Float32Array(n);
    const sumB = new Float32Array(n);
    const count = new Uint16Array(n);
    for (let y = 0; y < height; y++) {
      const row = Math.floor(y / cellPx);
      if (row >= rows) break;
      for (let x = 0; x < width; x++) {
        const col = Math.min(cols - 1, Math.floor(x / cellPx));
        const i = row * cols + col;
        const p = (y * width + x) * channels;
        const r = data[p]!;
        const g = data[p + 1]!;
        const b = data[p + 2]!;
        sumY[i]! += 0.2126 * LINEAR[r]! + 0.7152 * LINEAR[g]! + 0.0722 * LINEAR[b]!;
        sumR[i]! += r;
        sumG[i]! += g;
        sumB[i]! += b;
        count[i]!++;
      }
    }
    const frame = this.times.length;
    const last = this.times[frame - 1];
    if (last !== undefined && this.gap) this.shift = Math.max(this.shift, last + 2 - t);
    const at = t + this.shift;
    if (last !== undefined && !this.gap) this.seconds += Math.max(0, Math.min(0.5, at - last));
    if (last === undefined || this.gap) this.segStart.push(at);
    this.gap = false;
    this.times.push(at);
    this.segs.push(this.segStart.length - 1);
    for (let i = 0; i < n; i++) {
      const k = count[i]! || 1;
      this.lum!.update(i, sumY[i]! / k, frame);
      const r = sumR[i]! / k / 255;
      const g = sumG[i]! / k / 255;
      const b = sumB[i]! / k / 255;
      const sum = r + g + b;
      this.redz!.update(i, sum > 0 && r / sum >= 0.8 ? Math.max(0, r - g - b) * 320 : 0, frame);
    }
  }

  /** Ends a capture segment: what follows is a new stretch of time. */
  cut(): Promise<void> {
    this.queue = this.queue.then(() => {
      this.lum?.cut();
      this.redz?.cut();
      this.gap = true;
    });
    return this.queue;
  }

  async result(): Promise<FlashResult> {
    await this.cut();
    const frames = this.times.length;
    const general = this.analyse(this.general, "general");
    const red = this.analyse(this.red, "red");
    const worst = [general, red].filter((w): w is FlashWorst => w !== null).sort((a, b) => b.flashes - a.flashes)[0] ?? null;
    return { general: general?.flashes ?? 0, red: red?.flashes ?? 0, frames, seconds: this.seconds, worst };
  }

  /** The most flashes (pairs of field-wide transitions) any 10° field made within one second. */
  private analyse(ev: Events, kind: FlashWorst["kind"]): FlashWorst | null {
    const { cols, rows, times } = this;
    if (!ev.length || !cols) return null;
    const frames = times.length;
    const start = new Int32Array(frames + 1);
    for (let k = 0; k < ev.length; k++) start[ev.frame[k]! + 1]!++;
    for (let f = 0; f < frames; f++) start[f + 1]! += start[f]!;
    const byFrame = new Int32Array(ev.length);
    const fill = start.slice(0, frames);
    for (let k = 0; k < ev.length; k++) byFrame[fill[ev.frame[k]!]!++] = ev.cell[k]!;

    const field = Math.min(FIELD_CELLS, cols, rows);
    const xs = positions(cols, field);
    const ys = positions(rows, field);
    const fields = xs.flatMap((x) => ys.map((y) => ({ x, y, transitions: [] as number[] })));
    const need = Math.ceil(field * field * AREA);
    const brighter = new Uint8Array(cols * rows);
    const darker = new Uint8Array(cols * rows);
    const satUp = new Int32Array((cols + 1) * (rows + 1));
    const satDown = new Int32Array((cols + 1) * (rows + 1));
    // Cells that turned each way on the previous frame, per field, and whether that frame already counted.
    const prevUp = new Int32Array(fields.length);
    const prevDown = new Int32Array(fields.length);
    const prevCounted = new Uint8Array(fields.length);
    for (let f = 0; f < frames; f++) {
      if (start[f + 1] === start[f]) {
        prevUp.fill(0);
        prevDown.fill(0);
        prevCounted.fill(0);
        continue;
      }
      brighter.fill(0);
      darker.fill(0);
      for (let k = start[f]!; k < start[f + 1]!; k++) {
        const c = byFrame[k]!;
        if (c > 0) brighter[c - 1] = 1;
        else darker[-c - 1] = 1;
      }
      summedArea(brighter, cols, rows, satUp);
      summedArea(darker, cols, rows, satDown);
      fields.forEach((fd, i) => {
        const up = boxSum(satUp, cols, fd.x, fd.y, field);
        const down = boxSum(satDown, cols, fd.x, fd.y, field);
        const late = !prevCounted[i] && (up + prevUp[i]! >= need || down + prevDown[i]! >= need);
        const counted = up >= need || down >= need || late;
        if (counted) fd.transitions.push(f);
        prevUp[i] = up;
        prevDown[i] = down;
        prevCounted[i] = counted ? 1 : 0;
      });
    }
    let worst: FlashWorst | null = null;
    for (const fd of fields) {
      const list = fd.transitions;
      for (let a = 0, b = 0; a < list.length; a++) {
        while (b < list.length && times[list[b]!]! - times[list[a]!]! < 1) b++;
        const flashes = Math.floor((b - a) / 2);
        if (flashes > 0 && (!worst || flashes > worst.flashes)) {
          const segment = this.segs[list[a]!]!;
          worst = { kind, flashes, segment, at: times[list[a]!]! - this.segStart[segment]!, x: fd.x * CELL_CSS, y: fd.y * CELL_CSS, size: field * CELL_CSS };
        }
      }
    }
    return worst;
  }
}

function positions(cells: number, field: number): number[] {
  const out: number[] = [];
  for (let p = 0; p + field <= cells; p += STRIDE_CELLS) out.push(p);
  if (out[out.length - 1] !== cells - field) out.push(cells - field);
  return out;
}

function summedArea(src: Uint8Array, cols: number, rows: number, out: Int32Array): void {
  const w = cols + 1;
  for (let y = 0; y < rows; y++) {
    let run = 0;
    for (let x = 0; x < cols; x++) {
      run += src[y * cols + x]!;
      out[(y + 1) * w + x + 1] = out[y * w + x + 1]! + run;
    }
  }
}

function boxSum(sat: Int32Array, cols: number, x: number, y: number, size: number): number {
  const w = cols + 1;
  return sat[(y + size) * w + x + size]! - sat[y * w + x + size]! - sat[(y + size) * w + x]! + sat[y * w + x]!;
}
