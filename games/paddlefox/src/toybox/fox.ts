import { Group, Mesh, type Material } from "three";
import { P } from "./palette.ts";
import { Vox } from "./vox.ts";

/**
 * The fox. Built in voxel units (1 = one small cube) facing +Z with its feet at y = 0, then scaled.
 * Parts are separate meshes on pivots so it can trot, wag and nod.
 */
export interface Fox {
  root: Group;
  /** Squash/bob pivot (at the feet). */
  body: Group;
  head: Group;
  tail: Group;
  legs: Group[];
  /** Advance the trot. `phase` in radians, `amount` 0..1 (0 = standing). */
  trot(phase: number, amount: number): void;
  setShadows(on: boolean): void;
}

export function createFox(mat: Material, scale = 0.055): Fox {
  const root = new Group();
  const body = new Group();
  root.add(body);
  root.scale.setScalar(scale);

  const torso = new Vox()
    .box(0, 4.7, -0.4, 5, 3.8, 8, P.fox)
    .box(0, 4.3, 3.6, 3.6, 3, 0.8, P.foxCream)
    .box(0, 2.95, 0.4, 3.6, 0.5, 5.2, P.foxCream)
    .box(0, 6.7, -1.2, 3.8, 0.4, 4.6, P.foxDeep);
  const torsoMesh = new Mesh(torso.build(), mat);
  body.add(torsoMesh);

  const head = new Group();
  head.position.set(0, 6.2, 2.8);
  const hv = new Vox()
    .box(0, 1.6, 1.4, 5.6, 4.6, 4.6, P.fox)
    .box(0, 0.25, 2.2, 6.4, 1.9, 3.2, P.foxCream)
    .box(0, 0.65, 4.6, 2.8, 1.8, 2.4, P.foxCream)
    .box(0, 1.4, 5.95, 1.3, 1.1, 0.7, P.foxDark)
    .box(1.55, 2.25, 3.85, 0.9, 1.3, 0.4, P.foxDark)
    .box(-1.55, 2.25, 3.85, 0.9, 1.3, 0.4, P.foxDark)
    .box(1.9, 4.9, 0.6, 1.7, 2.4, 1.2, P.fox)
    .box(-1.9, 4.9, 0.6, 1.7, 2.4, 1.2, P.fox)
    .box(1.9, 6.55, 0.6, 1.7, 0.9, 1.2, P.foxDark)
    .box(-1.9, 6.55, 0.6, 1.7, 0.9, 1.2, P.foxDark)
    .box(0, 3.95, 1.4, 4.6, 0.3, 3.6, P.foxDeep);
  head.add(new Mesh(hv.build(), mat));
  body.add(head);

  const tail = new Group();
  tail.position.set(0, 5.2, -4.4);
  tail.rotation.x = 0.55;
  const tv = new Vox().box(0, 0, -2.4, 3, 2.8, 5, P.fox).box(0, 0, -5.6, 3, 2.8, 1.6, P.foxCream).box(0, 1.5, -2.6, 2.2, 0.3, 3.6, P.foxDeep);
  tail.add(new Mesh(tv.build(), mat));
  body.add(tail);

  const legGeo = new Vox().box(0, -0.9, 0, 1.4, 1.8, 1.4, P.fox).box(0, -2.35, 0.1, 1.4, 1.1, 1.6, P.foxDark).build();
  const legs: Group[] = [];
  for (const [x, z] of [
    [1.5, 2.4],
    [-1.5, 2.4],
    [1.5, -2.8],
    [-1.5, -2.8],
  ] as const) {
    const g = new Group();
    g.position.set(x, 2.9, z);
    g.add(new Mesh(legGeo, mat));
    body.add(g);
    legs.push(g);
  }

  const fox: Fox = {
    root,
    body,
    head,
    tail,
    legs,
    trot(phase, amount) {
      const s = Math.sin(phase);
      const swing = 0.75 * amount;
      // Diagonal pairs move together: a proper trot.
      legs[0]!.rotation.x = s * swing;
      legs[3]!.rotation.x = s * swing;
      legs[1]!.rotation.x = -s * swing;
      legs[2]!.rotation.x = -s * swing;
      body.position.y = Math.abs(Math.cos(phase)) * 0.7 * amount;
      head.rotation.x = Math.cos(phase * 2) * 0.05 * amount;
      tail.rotation.y = Math.sin(phase * 0.5) * 0.35 * (0.4 + amount);
      tail.rotation.x = 0.55 + Math.cos(phase) * 0.08 * amount;
    },
    setShadows(on) {
      root.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = on;
      });
    },
  };
  fox.setShadows(true);
  return fox;
}
