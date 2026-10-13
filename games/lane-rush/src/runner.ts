import { BoxGeometry, CapsuleGeometry, CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry } from "three";

export const ACCENT = "#FF6A1A";

/**
 * The courier: a chunky low-poly runner in an orange shell with a dark visor and a trailing
 * scarf. Built from primitives so it costs nothing to load.
 */
export interface Runner {
  root: Group;
  /** Pose the runner. `phase` advances with distance; `air` 0..1 jump arc; `slide` 0..1 crouch; `lean` lane-change tilt. */
  pose(phase: number, air: number, slide: number, lean: number, dead: number): void;
  shadow: Mesh;
}

export function createRunner(): Runner {
  const shell = new MeshLambertMaterial({ color: ACCENT });
  const dark = new MeshLambertMaterial({ color: "#20232B" });
  const visor = new MeshLambertMaterial({ color: "#0D0D10", emissive: "#3DE0FF", emissiveIntensity: 0.35 });
  const limb = new MeshLambertMaterial({ color: "#2B2F3A" });
  const scarfMat = new MeshLambertMaterial({ color: "#F3F0E8" });

  const root = new Group();
  const body = new Group();
  root.add(body);

  const torso = new Mesh(new CapsuleGeometry(0.34, 0.5, 4, 10), shell);
  torso.position.y = 1.05;
  body.add(torso);
  const pack = new Mesh(new BoxGeometry(0.5, 0.52, 0.28), dark);
  pack.position.set(0, 1.12, 0.3);
  body.add(pack);
  const head = new Mesh(new SphereGeometry(0.27, 14, 10), shell);
  head.position.y = 1.72;
  body.add(head);
  const visorMesh = new Mesh(new BoxGeometry(0.42, 0.16, 0.2), visor);
  visorMesh.position.set(0, 1.74, -0.2);
  body.add(visorMesh);

  const scarf = new Group();
  scarf.position.set(0, 1.45, 0.18);
  const scarfTail = new Mesh(new BoxGeometry(0.12, 0.05, 0.62), scarfMat);
  scarfTail.position.z = 0.3;
  scarf.add(scarfTail);
  body.add(scarf);

  const legGeo = new CapsuleGeometry(0.11, 0.42, 3, 6);
  const armGeo = new CapsuleGeometry(0.08, 0.36, 3, 6);
  const mkLimb = (geo: CapsuleGeometry, x: number, y: number, len: number) => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const m = new Mesh(geo, limb);
    m.position.y = -len / 2;
    pivot.add(m);
    body.add(pivot);
    return pivot;
  };
  const legL = mkLimb(legGeo, -0.16, 0.7, 0.64);
  const legR = mkLimb(legGeo, 0.16, 0.7, 0.64);
  const armL = mkLimb(armGeo, -0.42, 1.32, 0.52);
  const armR = mkLimb(armGeo, 0.42, 1.32, 0.52);

  const shadow = new Mesh(new CircleGeometry(0.55, 20), new MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.35 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;

  return {
    root,
    shadow,
    pose(phase, air, slide, lean, dead) {
      const s = Math.sin(phase);
      const run = 1 - Math.max(air, slide);
      legL.rotation.x = s * 0.9 * run + air * -0.6;
      legR.rotation.x = -s * 0.9 * run + air * 0.4;
      armL.rotation.x = -s * 0.8 * run + air * 2.3;
      armR.rotation.x = s * 0.8 * run + air * 2.1;
      armL.rotation.z = air * 0.5;
      armR.rotation.z = -air * 0.5;
      body.position.y = Math.abs(Math.cos(phase)) * 0.08 * run;
      // Slide: lean back and drop low.
      body.rotation.x = slide * 1.05 - run * 0.14;
      body.position.y -= slide * 0.55;
      body.position.z = slide * 0.35;
      legL.rotation.x += slide * 0.5;
      legR.rotation.x += slide * 0.3;
      armL.rotation.x += slide * 1.2;
      armR.rotation.x += slide * 1.2;
      body.rotation.z = -lean * 0.35;
      scarf.rotation.x = -0.25 + Math.sin(phase * 2) * 0.18 - air * 0.4;
      scarf.rotation.y = Math.sin(phase * 1.3) * 0.25;
      if (dead > 0) {
        body.rotation.x = -dead * 1.6;
        body.position.y = dead * 0.2;
      }
    },
  };
}
