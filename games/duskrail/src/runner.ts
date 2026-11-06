import { BoxGeometry, CapsuleGeometry, CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type Vector3 } from "three";

export const ACCENT = "#FF6A1A";

/** Everything the courier's pose depends on. The game owns one and updates it every frame. */
export interface Pose {
  /** Run cycle angle: one full turn is two strides. */
  phase: number;
  /** 0..1 airborne blend. */
  air: number;
  /** -1 rising fast .. 1 falling fast. */
  fall: number;
  /** 0..1 knee-slide blend. */
  slide: number;
  /** -1..1 bank into a lane change. */
  lean: number;
  /** Landing squash: below 1 squashed, above 1 stretched. */
  squash: number;
  /** 0..1 wobble after scraping a box. */
  stagger: number;
  /** Seconds since the crash, 0 while alive. */
  dead: number;
}

/**
 * The courier: a chunky low-poly runner in an orange shell with a dark visor, a cargo pack and a
 * trailing scarf. Two-bone legs and arms so the stride reads; built from primitives so it costs
 * nothing to load.
 */
export interface Runner {
  root: Group;
  shadow: Mesh;
  pose(p: Pose): void;
  /** World position of a foot (0 left, 1 right), for dust. */
  foot(i: 0 | 1, out: Vector3): Vector3;
}

const HIP_Y = 0.76;
/** Height of the body's center of mass above the feet; the crash tumbles around it. */
const COM_Y = 0.95;

export function createRunner(): Runner {
  const shell = new MeshLambertMaterial({ color: ACCENT });
  const dark = new MeshLambertMaterial({ color: "#20232B" });
  const visor = new MeshLambertMaterial({ color: "#0D0D10", emissive: "#3DE0FF", emissiveIntensity: 0.35 });
  const limb = new MeshLambertMaterial({ color: "#2B2F3A" });
  const paper = new MeshLambertMaterial({ color: "#F3F0E8" });

  const root = new Group();
  // `body` carries squash, bank and the crash tumble; its origin sits at the feet.
  const body = new Group();
  root.add(body);
  const hips = new Group();
  hips.position.y = HIP_Y;
  body.add(hips);
  const pelvis = new Mesh(new BoxGeometry(0.5, 0.22, 0.3), dark);
  hips.add(pelvis);

  // Upper body pivots at the hips so it can lean independently of the legs.
  const spine = new Group();
  hips.add(spine);
  const torso = new Mesh(new CapsuleGeometry(0.33, 0.46, 4, 10), shell);
  torso.position.y = 0.34;
  spine.add(torso);
  const pack = new Mesh(new BoxGeometry(0.52, 0.56, 0.3), dark);
  pack.position.set(0, 0.42, 0.32);
  spine.add(pack);
  const packBand = new Mesh(new BoxGeometry(0.54, 0.07, 0.32), paper);
  packBand.position.set(0, 0.5, 0.32);
  spine.add(packBand);
  const neck = new Group();
  neck.position.y = 0.82;
  spine.add(neck);
  const head = new Mesh(new SphereGeometry(0.27, 14, 10), shell);
  head.position.y = 0.14;
  neck.add(head);
  const visorMesh = new Mesh(new BoxGeometry(0.42, 0.16, 0.2), visor);
  visorMesh.position.set(0, 0.16, -0.2);
  neck.add(visorMesh);

  const scarf = new Group();
  scarf.position.set(0, 0.69, 0.18);
  const scarfTail = new Mesh(new BoxGeometry(0.12, 0.05, 0.66), paper);
  scarfTail.position.z = 0.32;
  scarf.add(scarfTail);
  spine.add(scarf);

  /** A two-bone limb: returns [upper pivot, lower pivot]. Rotation.x > 0 swings the far end forward (-z). */
  const mkLimb = (parent: Group, x: number, y: number, upper: number, lower: number, r: number, end: Mesh): [Group, Group] => {
    const a = new Group();
    a.position.set(x, y, 0);
    const am = new Mesh(new CapsuleGeometry(r, upper - r * 2, 3, 6), limb);
    am.position.y = -upper / 2;
    a.add(am);
    const b = new Group();
    b.position.y = -upper;
    const bm = new Mesh(new CapsuleGeometry(r * 0.88, lower - r * 1.76, 3, 6), limb);
    bm.position.y = -lower / 2;
    b.add(bm);
    end.position.y -= lower;
    b.add(end);
    a.add(b);
    parent.add(a);
    return [a, b];
  };
  const shoeGeo = new BoxGeometry(0.18, 0.11, 0.32);
  const shoe = () => {
    const m = new Mesh(shoeGeo, paper);
    m.position.set(0, 0.04, -0.06);
    return m;
  };
  const gloveGeo = new SphereGeometry(0.09, 8, 6);
  const [thighL, kneeL] = mkLimb(hips, -0.15, 0, 0.38, 0.36, 0.12, shoe());
  const [thighR, kneeR] = mkLimb(hips, 0.15, 0, 0.38, 0.36, 0.12, shoe());
  const [armL, elbowL] = mkLimb(spine, -0.43, 0.6, 0.31, 0.28, 0.085, new Mesh(gloveGeo, dark));
  const [armR, elbowR] = mkLimb(spine, 0.43, 0.6, 0.31, 0.28, 0.085, new Mesh(gloveGeo, dark));
  const feet = [kneeL.children[1]!, kneeR.children[1]!];

  const shadow = new Mesh(new CircleGeometry(0.55, 20), new MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.35 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;

  // Scratch pose targets, blended per frame.
  const legs = { tL: 0, kL: 0, tR: 0, kR: 0 };
  const arms = { xL: 0, zL: 0, eL: 0, xR: 0, zR: 0, eR: 0 };
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;

  return {
    root,
    shadow,
    foot(i, out) {
      return feet[i]!.getWorldPosition(out);
    },
    pose(p) {
      const crash = p.dead > 0 ? 1 - (1 - Math.min(1, p.dead / 0.42)) ** 3 : 0;
      const slide = p.slide * (1 - crash);
      const air = p.air * (1 - slide) * (1 - crash);
      const run = (1 - air) * (1 - slide) * (1 - crash);
      const s = Math.sin(p.phase);
      const c = Math.cos(p.phase);

      // Stride: the thigh swings, the knee folds on the forward swing and straightens for the strike.
      legs.tL = s * 0.95;
      legs.kL = -(0.2 + Math.max(0, c) * 1.55);
      legs.tR = -s * 0.95;
      legs.kR = -(0.2 + Math.max(0, -c) * 1.55);
      arms.xL = -s * 0.9;
      arms.xR = s * 0.9;
      arms.zL = -0.12;
      arms.zR = 0.12;
      arms.eL = 1.25 + Math.max(0, -s) * 0.4;
      arms.eR = 1.25 + Math.max(0, s) * 0.4;
      let spineX = -0.24;
      let spineY = s * 0.2;
      let neckX = 0.16;
      let bodyY = (Math.abs(s) * 0.13 - 0.05) * run;

      // Air: tucked on the way up, legs reaching for the deck on the way down.
      if (air > 0) {
        const down = Math.min(1, Math.max(0, (p.fall + 0.6) / 1.4));
        const k = air;
        legs.tL = mix(legs.tL, mix(1.35, 0.55, down), k);
        legs.kL = mix(legs.kL, mix(-1.75, -0.35, down), k);
        legs.tR = mix(legs.tR, mix(0.45, -0.15, down), k);
        legs.kR = mix(legs.kR, mix(-1.35, -0.7, down), k);
        arms.xL = mix(arms.xL, mix(2.5, 0.5, down), k);
        arms.xR = mix(arms.xR, mix(2.3, 0.3, down), k);
        arms.zL = mix(arms.zL, mix(-0.35, -1.2, down), k);
        arms.zR = mix(arms.zR, mix(0.35, 1.2, down), k);
        arms.eL = mix(arms.eL, 0.35, k);
        arms.eR = mix(arms.eR, 0.35, k);
        spineX = mix(spineX, mix(-0.12, 0.08, down), k);
        spineY *= 1 - k;
      }

      // Knee slide: hips drop, lead leg out front, trailing leg folded, torso laid back.
      if (slide > 0) {
        legs.tL = mix(legs.tL, 1.45, slide);
        legs.kL = mix(legs.kL, -0.08, slide);
        legs.tR = mix(legs.tR, 0.3, slide);
        legs.kR = mix(legs.kR, -2.1, slide);
        arms.xL = mix(arms.xL, -0.7, slide);
        arms.zL = mix(arms.zL, -0.55, slide);
        arms.eL = mix(arms.eL, 0.2, slide);
        arms.xR = mix(arms.xR, 1.1, slide);
        arms.zR = mix(arms.zR, 0.25, slide);
        arms.eR = mix(arms.eR, 0.9, slide);
        spineX = mix(spineX, 1.0, slide);
        spineY *= 1 - slide;
        neckX = mix(neckX, -0.75, slide);
        bodyY = mix(bodyY, -0.52, slide);
      }

      // Crash: thrown backwards off the obstacle, limbs flung forward, then flat on the back.
      let tumble = 0;
      if (crash > 0) {
        const flail = Math.sin(p.dead * 22) * 0.35 * (1 - crash);
        const settled = Math.min(1, Math.max(0, (p.dead - 0.35) / 0.3));
        legs.tL = mix(legs.tL, mix(1.1 + flail, 0.45, settled), crash);
        legs.kL = mix(legs.kL, mix(-0.9, -0.35, settled), crash);
        legs.tR = mix(legs.tR, mix(0.6 - flail, 0.2, settled), crash);
        legs.kR = mix(legs.kR, mix(-0.4, -0.6, settled), crash);
        arms.xL = mix(arms.xL, mix(2.2 + flail, 1.4, settled), crash);
        arms.xR = mix(arms.xR, mix(2.0 - flail, 1.6, settled), crash);
        arms.zL = mix(arms.zL, mix(-1.0, -1.35, settled), crash);
        arms.zR = mix(arms.zR, mix(1.0, 1.35, settled), crash);
        arms.eL = mix(arms.eL, 0.5, crash);
        arms.eR = mix(arms.eR, 0.5, crash);
        spineX = mix(spineX, mix(0.35, 0.1, settled), crash);
        spineY *= 1 - crash;
        neckX = mix(neckX, mix(-0.55, -0.2, settled), crash);
        tumble = crash * 1.48;
        bodyY *= 1 - crash;
      }

      thighL.rotation.x = legs.tL;
      kneeL.rotation.x = legs.kL;
      thighR.rotation.x = legs.tR;
      kneeR.rotation.x = legs.kR;
      armL.rotation.x = arms.xL;
      armL.rotation.z = arms.zL;
      elbowL.rotation.x = arms.eL;
      armR.rotation.x = arms.xR;
      armR.rotation.z = arms.zR;
      elbowR.rotation.x = arms.eR;
      // Shoulders counter the hips.
      hips.rotation.y = -spineY * 0.6;
      spine.rotation.x = spineX;
      spine.rotation.y = spineY;
      spine.rotation.z = Math.sin(p.dead > 0 ? 0 : p.stagger * 30) * 0.22 * p.stagger;
      neck.rotation.x = neckX;
      scarf.rotation.x = -0.25 + Math.sin(p.phase * 2) * 0.18 * run - air * 0.45 - slide * 0.9;
      scarf.rotation.y = Math.sin(p.phase * 1.3) * 0.25;

      // Squash and stretch keep volume.
      const sq = p.squash;
      const wide = 1 / Math.sqrt(sq);
      body.scale.set(wide, sq, wide);
      // Bank into lane changes; a scrape knocks the whole body sideways.
      body.rotation.z = -p.lean * 0.32 + Math.sin(p.stagger * 24) * 0.12 * p.stagger;
      // The tumble turns around the center of mass, so the feet sweep forward as the back drops.
      body.rotation.x = tumble;
      body.position.set(0, bodyY + (COM_Y - COM_Y * Math.cos(tumble)) - crash * 0.6, -COM_Y * Math.sin(tumble));
    },
  };
}
