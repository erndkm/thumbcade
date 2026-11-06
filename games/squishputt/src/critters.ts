/**
 * The audience: three clay critters posed by hand at 12 fps. They watch the ball, blink, cheer when it drops,
 * gasp at a splash, droop when the run ends and hop to new seats between holes.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import type { Object3D} from "three";
import { CapsuleGeometry, CatmullRomCurve3, Group, Mesh, SphereGeometry, TorusGeometry, TubeGeometry, Vector3 } from "three";
import { lumpify, type ClayKit } from "./clay.ts";
import { PAL } from "./palette.ts";

export type Mood = "idle" | "cheer" | "gasp" | "sad";

export interface Critter {
  root: Group;
  /** Turns toward the action. */
  head: Object3D;
  eyes: Object3D[];
  /** Height of the head top (speech bubble anchor). */
  top: number;
  base: Vector3;
  yaw: number;
  hop: { from: Vector3; to: Vector3; step: number; steps: number } | null;
  blinkIn: number;
  seed: number;
  size: number;
}

function eye(kit: ClayKit, r: number): Group {
  const g = new Group();
  const white = new Mesh(new SphereGeometry(r, 14, 10), kit.clay(PAL.cream));
  const pupil = new Mesh(new SphereGeometry(r * 0.55, 12, 8), kit.clay(PAL.chocDeep, "glossy"));
  pupil.position.z = r * 0.62;
  pupil.scale.z = 0.6;
  g.add(white, pupil);
  return g;
}

function blob(kit: ClayKit, w: number, h: number): Mesh {
  const m = new Mesh(new SphereGeometry(1, 16, 8), kit.shadowMat);
  m.scale.set(w, 0.001, h);
  m.position.y = 0.006;
  return m;
}

function snail(kit: ClayKit): Critter {
  const root = new Group();
  // A long, soft foot: the part you see from above.
  const body = new Mesh(lumpify(new CapsuleGeometry(0.085, 0.36, 6, 14), 0.012, 9, 1), kit.clay(PAL.powder));
  body.rotation.z = Math.PI / 2;
  body.scale.set(0.75, 1, 1);
  body.position.set(0.02, 0.06, 0);
  body.castShadow = true;
  // The shell leans toward the camera so its spiral shows.
  const shellG = new Group();
  shellG.position.set(-0.07, 0.2, 0);
  shellG.rotation.set(-0.7, 0, 0.15);
  const shell = new Mesh(lumpify(new SphereGeometry(0.16, 20, 14), 0.02, 6, 2), kit.clay(PAL.lavender));
  shell.scale.set(1, 1, 0.78);
  shell.castShadow = true;
  const pts: Vector3[] = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    const a = t * Math.PI * 4;
    const r = 0.135 * (1 - t * 0.9);
    pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.12 + t * 0.012));
  }
  const spiral = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 60, 0.017, 6), kit.clay(PAL.cream));
  shellG.add(shell, spiral);
  const head = new Group();
  head.position.set(0.22, 0.1, 0);
  const nose = new Mesh(new SphereGeometry(0.085, 14, 10), kit.clay(PAL.powder));
  nose.scale.set(1, 0.9, 0.9);
  head.add(nose);
  for (const s of [-1, 1]) {
    const stalk = new Mesh(new CapsuleGeometry(0.018, 0.16, 3, 6), kit.clay(PAL.powder));
    stalk.position.set(0.02, 0.13, s * 0.045);
    stalk.rotation.x = s * -0.3;
    head.add(stalk);
  }
  const eyes = [-1, 1].map((s) => {
    const e = eye(kit, 0.042);
    e.position.set(0.03, 0.24, s * 0.08);
    e.rotation.y = Math.PI / 2;
    head.add(e);
    return e;
  });
  const cheek = new Mesh(new SphereGeometry(0.025, 8, 6), kit.clay(PAL.pink));
  cheek.position.set(0.07, 0.0, 0.07);
  head.add(cheek);
  root.add(body, shellG, head, blob(kit, 0.34, 0.17));
  return { root, head, eyes, top: 0.5, base: new Vector3(), yaw: 0, hop: null, blinkIn: 2, seed: 1, size: 1.75 };
}

function frog(kit: ClayKit): Critter {
  const root = new Group();
  const body = new Mesh(lumpify(new SphereGeometry(0.2, 22, 16), 0.018, 5, 3), kit.clay(PAL.sageDeep));
  body.scale.set(1.05, 0.72, 0.95);
  body.position.y = 0.14;
  body.castShadow = true;
  const belly = new Mesh(new SphereGeometry(0.15, 16, 12), kit.clay(PAL.cream));
  belly.scale.set(0.5, 0.62, 0.9);
  belly.position.set(0.13, 0.12, 0);
  const head = new Group();
  head.position.set(0, 0.22, 0);
  const eyes = [-1, 1].map((s) => {
    const dome = new Mesh(new SphereGeometry(0.075, 14, 10), kit.clay(PAL.sageDeep));
    dome.position.set(0.06, 0.04, s * 0.1);
    dome.castShadow = true;
    head.add(dome);
    const e = eye(kit, 0.05);
    e.position.set(0.1, 0.06, s * 0.1);
    e.rotation.y = Math.PI / 2;
    head.add(e);
    const cheek = new Mesh(new SphereGeometry(0.03, 10, 6), kit.clay(PAL.pink));
    cheek.position.set(0.17, -0.06, s * 0.12);
    cheek.scale.set(0.5, 0.6, 1);
    head.add(cheek);
    return e;
  });
  const mouth = new Mesh(new TorusGeometry(0.08, 0.011, 5, 16, Math.PI * 0.7), kit.clay(PAL.chocDeep));
  mouth.rotation.set(0, Math.PI / 2, Math.PI + Math.PI * 0.15);
  mouth.position.set(0.19, -0.02, 0);
  head.add(mouth);
  for (const s of [-1, 1]) {
    const foot = new Mesh(new SphereGeometry(0.06, 10, 8), kit.clay(PAL.sage));
    foot.scale.set(1.3, 0.4, 1);
    foot.position.set(0.12, 0.02, s * 0.14);
    root.add(foot);
  }
  root.add(body, belly, head, blob(kit, 0.3, 0.28));
  return { root, head, eyes, top: 0.42, base: new Vector3(), yaw: 0, hop: null, blinkIn: 3, seed: 2, size: 1.7 };
}

function chick(kit: ClayKit): Critter {
  const root = new Group();
  const body = new Mesh(lumpify(new SphereGeometry(0.17, 22, 16), 0.014, 6, 4), kit.clay(PAL.butter));
  body.position.y = 0.19;
  body.scale.set(1, 1.05, 1);
  body.castShadow = true;
  const head = new Group();
  head.position.set(0, 0.24, 0);
  const beak = new Mesh(new SphereGeometry(0.04, 10, 8), kit.clay(PAL.salmonDeep));
  beak.scale.set(1.5, 0.7, 0.9);
  beak.position.set(0.17, 0.0, 0);
  head.add(beak);
  const eyes = [-1, 1].map((s) => {
    const e = new Mesh(new SphereGeometry(0.026, 10, 8), kit.clay(PAL.chocDeep, "glossy"));
    e.position.set(0.13, 0.05, s * 0.075);
    head.add(e);
    return e as Object3D;
  });
  for (let i = 0; i < 3; i++) {
    const tuft = new Mesh(new SphereGeometry(0.03, 8, 6), kit.clay(PAL.butterDeep));
    tuft.position.set(-0.02 + i * 0.03, 0.17 + (i === 1 ? 0.02 : 0), 0);
    tuft.scale.set(0.7, 1.4, 0.7);
    tuft.rotation.z = (1 - i) * 0.5;
    head.add(tuft);
  }
  for (const s of [-1, 1]) {
    const wing = new Mesh(new SphereGeometry(0.08, 12, 8), kit.clay(PAL.butterDeep));
    wing.scale.set(0.9, 0.55, 0.3);
    wing.position.set(-0.02, 0.17, s * 0.16);
    wing.rotation.x = s * 0.4;
    root.add(wing);
    const foot = new Mesh(new SphereGeometry(0.035, 8, 6), kit.clay(PAL.salmon));
    foot.scale.set(1.5, 0.5, 1);
    foot.position.set(0.04, 0.015, s * 0.06);
    root.add(foot);
  }
  root.add(body, head, blob(kit, 0.24, 0.24));
  return { root, head, eyes, top: 0.5, base: new Vector3(), yaw: 0, hop: null, blinkIn: 1.5, seed: 3, size: 1.8 };
}

export function createCritters(kit: ClayKit): Critter[] {
  return [chick(kit), frog(kit), snail(kit)];
}

/** Sends a critter hopping to a new seat (stop-motion arc). */
export function hopTo(c: Critter, x: number, y: number, z: number, steps = 9): void {
  c.hop = { from: c.base.clone(), to: new Vector3(x, y, z), step: 0, steps };
}

export function place(c: Critter, x: number, y: number, z: number): void {
  c.base.set(x, y, z);
  c.hop = null;
}

const CHEER = [0, -0.03, 0.1, 0.17, 0.19, 0.14, 0.05, -0.02, 0];
const SQUASH = [1, 0.84, 1.12, 1.06, 1, 1.02, 1.04, 0.86, 1];

/** One stop-motion step (call 12 times a second). */
export function poseCritter(c: Critter, rng: Rng, look: Vector3, mood: Mood, moodStep: number, reduced: boolean): void {
  let x = c.base.x;
  let y = c.base.y;
  let z = c.base.z;
  let squash = 1;
  if (c.hop) {
    c.hop.step++;
    const t = Math.min(1, c.hop.step / c.hop.steps);
    x = c.hop.from.x + (c.hop.to.x - c.hop.from.x) * t;
    z = c.hop.from.z + (c.hop.to.z - c.hop.from.z) * t;
    y = c.hop.from.y + (c.hop.to.y - c.hop.from.y) * t + Math.sin(t * Math.PI) * (reduced ? 0.15 : 0.55);
    squash = t < 0.15 ? 0.85 : t > 0.9 ? 0.88 : 1.08;
    if (t >= 1) {
      c.base.copy(c.hop.to);
      c.hop = null;
    }
  } else if (mood === "cheer" && moodStep < CHEER.length * 2) {
    const i = (moodStep + Math.round(c.seed)) % CHEER.length;
    y += CHEER[i]! * (reduced ? 0.35 : 1);
    squash = SQUASH[i]!;
  } else if (moodStep % 12 < 6) {
    // Breathing, held on twos like a hand-posed puppet.
    squash = 1.025;
  }
  // The hand that posed it never puts it back in exactly the same place.
  const j = reduced ? 0.3 : 1;
  c.root.position.set(x + rng.range(-0.004, 0.004) * j, y, z + rng.range(-0.004, 0.004) * j);
  const k = c.size;
  c.root.scale.set(k / Math.sqrt(squash), k * squash, k / Math.sqrt(squash));
  c.root.rotation.z = rng.range(-0.02, 0.02) * j;

  // Face the action: the body turns in chunky steps, the head does the rest.
  const want = Math.atan2(-(look.z - z), look.x - x);
  let d = want - c.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) > 0.7) c.yaw += Math.sign(d) * 0.18;
  c.root.rotation.y = c.yaw;
  let hd = want - c.yaw;
  while (hd > Math.PI) hd -= Math.PI * 2;
  while (hd < -Math.PI) hd += Math.PI * 2;
  c.head.rotation.y = Math.max(-0.8, Math.min(0.8, hd)) + rng.range(-0.03, 0.03) * j;
  c.head.rotation.z = mood === "gasp" ? 0.32 : mood === "sad" ? -0.3 : mood === "cheer" ? 0.12 : rng.range(-0.03, 0.05) * j;

  c.blinkIn -= 1 / 12;
  const blink = c.blinkIn < 0;
  if (c.blinkIn < -0.09) c.blinkIn = 1.8 + rng() * 3;
  const eyeScale = mood === "gasp" ? 1.3 : 1;
  for (const e of c.eyes) e.scale.set(eyeScale, blink && mood !== "gasp" ? 0.12 : eyeScale, eyeScale);
}
