import { BoxGeometry, Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from "three";
import { col, type ColorLike } from "./vox.ts";

/** Tiny tumbling cubes: dust, splashes, berry pops. One instanced draw call, no allocation per frame. */

export interface PuffOptions {
  count: number;
  colors: readonly ColorLike[];
  /** Horizontal speed range (units/s). */
  speed: [number, number];
  /** Upward speed range (units/s). */
  up: [number, number];
  size: [number, number];
  life: [number, number];
  gravity?: number;
  spread?: number;
  /** Bias the horizontal direction (unit vector) with this weight 0..1. */
  dir?: { x: number; z: number; weight: number };
  /** Stop falling at this height (cubes land and shrink). */
  floor?: number;
}

export class Puffs {
  readonly mesh: InstancedMesh;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly rx: Float32Array;
  private readonly ry: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly grav: Float32Array;
  private readonly floor: Float32Array;
  private next = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(readonly capacity = 220) {
    const mat = new MeshLambertMaterial();
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.rx = f();
    this.ry = f();
    this.size = f();
    this.life = f();
    this.max = f();
    this.grav = f();
    this.floor = f();
    const white = new Color(1, 1, 1);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setColorAt(i, white);
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = 0;
  }

  emit(x: number, y: number, z: number, o: PuffOptions): void {
    const r = (a: [number, number]) => a[0] + Math.random() * (a[1] - a[0]);
    for (let k = 0; k < o.count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const a = Math.random() * Math.PI * 2;
      let dx = Math.cos(a);
      let dz = Math.sin(a);
      if (o.dir) {
        dx = dx * (1 - o.dir.weight) + o.dir.x * o.dir.weight;
        dz = dz * (1 - o.dir.weight) + o.dir.z * o.dir.weight;
      }
      const sp = r(o.speed);
      const j = o.spread ?? 0;
      this.px[i] = x + (Math.random() - 0.5) * j;
      this.py[i] = y;
      this.pz[i] = z + (Math.random() - 0.5) * j;
      this.vx[i] = dx * sp;
      this.vz[i] = dz * sp;
      this.vy[i] = r(o.up);
      this.rx[i] = Math.random() * 6;
      this.ry[i] = Math.random() * 6;
      this.size[i] = r(o.size);
      this.life[i] = this.max[i] = r(o.life);
      this.grav[i] = o.gravity ?? 9;
      this.floor[i] = o.floor ?? -50;
      this.mesh.setColorAt(i, col(o.colors[Math.floor(Math.random() * o.colors.length)]!));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.capacity;
  }

  update(dt: number): void {
    if (this.mesh.count === 0) return;
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      const l = (this.life[i] = this.life[i]! - dt);
      this.vy[i] = this.vy[i]! - this.grav[i]! * dt;
      const drag = Math.exp(-1.6 * dt);
      this.vx[i] = this.vx[i]! * drag;
      this.vz[i] = this.vz[i]! * drag;
      this.px[i] = this.px[i]! + this.vx[i]! * dt;
      this.py[i] = this.py[i]! + this.vy[i]! * dt;
      this.pz[i] = this.pz[i]! + this.vz[i]! * dt;
      if (this.py[i]! < this.floor[i]!) {
        this.py[i] = this.floor[i]!;
        this.vy[i] = 0;
        this.vx[i] = this.vx[i]! * 0.5;
        this.vz[i] = this.vz[i]! * 0.5;
      }
      this.rx[i] = this.rx[i]! + dt * 7;
      this.ry[i] = this.ry[i]! + dt * 5;
      const k = l <= 0 ? 0 : Math.min(1, (l / this.max[i]!) * 2.2);
      const s = this.size[i]! * k;
      this.e.set(this.rx[i]!, this.ry[i]!, 0);
      this.q.setFromEuler(this.e);
      this.p.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      this.s.set(s, s, s);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!any) this.mesh.count = 0;
  }

  clear(): void {
    this.life.fill(0);
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = 0;
  }

  /** Keeps the instanced shader warm: call once before the first render so no frame compiles it later. */
  warm(): void {
    this.mesh.count = 1;
  }
}
