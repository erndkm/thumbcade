export interface LoopOptions {
  /** Largest dt (seconds) passed to the callback. Protects physics after a hitch. Default 0.1. */
  maxDt?: number;
}

export interface LoopHandle {
  /** Restart a loop stopped with stop(). It still stays paused while the shell has the game paused. */
  start(): void;
  /** Stop the loop for good (until start()). */
  stop(): void;
  /** True while frames are being delivered. */
  readonly running: boolean;
}

/** `dt` = seconds since the previous frame (0 on the first frame), `time` = seconds the loop has run. */
export type LoopCallback = (dt: number, time: number) => void;

interface LoopImpl {
  kick(): void;
  halt(): void;
}

export interface LoopRegistry {
  loop(cb: LoopCallback, opts?: LoopOptions): LoopHandle;
  pause(): void;
  resume(): void;
}

/**
 * rAF loops that stop while the shell has the game paused and resume afterwards. Paused time is
 * never reported as dt, so physics doesn't jump after a resume.
 */
export function createLoops(win: Window): LoopRegistry {
  const live = new Set<LoopImpl>();
  let paused = false;

  function loop(cb: LoopCallback, opts: LoopOptions = {}): LoopHandle {
    const maxDt = opts.maxDt ?? 0.1;
    let raf = 0;
    let last = -1;
    let time = 0;
    let wanted = true;

    const frame = (now: number) => {
      raf = 0;
      if (!wanted || paused) return;
      const dt = last < 0 ? 0 : Math.min(Math.max((now - last) / 1000, 0), maxDt);
      last = now;
      time += dt;
      // Schedule first so the callback can stop() the loop and a throwing callback doesn't kill it.
      raf = win.requestAnimationFrame(frame);
      cb(dt, time);
    };
    const impl: LoopImpl = {
      kick() {
        if (!raf && wanted && !paused) {
          last = -1;
          raf = win.requestAnimationFrame(frame);
        }
      },
      halt() {
        if (raf) win.cancelAnimationFrame(raf);
        raf = 0;
      },
    };
    live.add(impl);
    impl.kick();
    return {
      start() {
        wanted = true;
        live.add(impl);
        impl.kick();
      },
      stop() {
        wanted = false;
        live.delete(impl);
        impl.halt();
      },
      get running() {
        return wanted && !paused;
      },
    };
  }

  return {
    loop,
    pause() {
      paused = true;
      live.forEach((l) => l.halt());
    },
    resume() {
      paused = false;
      live.forEach((l) => l.kick());
    },
  };
}
