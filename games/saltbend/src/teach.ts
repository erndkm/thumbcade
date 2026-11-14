/**
 * First-run teaching, pure so the screenshot planner can replay it: the coach's word ("hold" / "let go") and the
 * little wait at the first two bends of a first run, where time slows to 0.45× (for 1.3 s at most) while the coach
 * wants a press the player hasn't made yet. After three clean lines the game stores `hint` and never teaches again.
 */
import { damp } from "@thumbcade-games/kit/ease";
import { Coach } from "./pilot.ts";
import type { Run } from "./sim.ts";

export const TEACH_SLOW = 0.45;
export const TEACH_BENDS = 2;
/** Each of those bends waits this long at most (wall seconds), so an idle first run still ends on its own. */
export const TEACH_WAIT = 1.3;

export class Teacher {
  readonly coach = new Coach();
  /** The time scale the run is played at now. */
  slow = 1;
  /** Does the coach want a hold right now? */
  wants = false;
  private bends = new Map<number, number>();

  reset(): void {
    this.slow = 1;
    this.wants = false;
    this.bends.clear();
  }

  /** `teaching`: a first run whose player hasn't learned yet. `graded`: clean lines the player drew this run. */
  update(run: Run, teaching: boolean, graded: number, rawDt: number): number {
    this.wants = run.phase === "drive" ? this.coach.advise(run) : false;
    let target = 1;
    if (teaching && run.phase === "drive" && this.wants && !run.holding && graded < TEACH_BENDS) {
      const b = run.course.bendSegAhead(run.s, run.v * 0.6);
      if (b && (this.bends.has(b.i) || this.bends.size < TEACH_BENDS)) {
        const waited = (this.bends.get(b.i) ?? 0) + rawDt;
        this.bends.set(b.i, waited);
        if (waited < TEACH_WAIT) target = TEACH_SLOW;
      }
    }
    this.slow = damp(this.slow, target, target < this.slow ? 7 : 4, rawDt);
    return this.slow;
  }
}
