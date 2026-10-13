import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  type Material,
} from "three";
import { ACCENT } from "./runner.ts";

export const LANE = 1.75;
export const DECK_W = 6.6;
export const SKY_TOP = "#0F2F3A";
export const SKY_HORIZON = "#F2A65A";
export const FOG = "#D88E5B";

function gradientTexture(stops: Array<[number, string]>): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const lg = g.createLinearGradient(0, 0, 0, 256);
  for (const [o, col] of stops) lg.addColorStop(o, col);
  g.fillStyle = lg;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function stripeTexture(a: string, b: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = b;
  for (let x = -16; x < 80; x += 16) {
    g.beginPath();
    g.moveTo(x, 16);
    g.lineTo(x + 8, 0);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 8, 16);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function corrugatedTexture(base: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 8) {
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(x, 0, 3, 64);
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(x + 4, 0, 1, 64);
  }
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fillRect(0, 0, 64, 3);
  g.fillRect(0, 61, 64, 3);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export type ObstacleKind = "bar" | "gate" | "crate" | "rover";

export interface Kit {
  scene: Scene;
  /** Moving scenery (lane dashes, lamps, pillars) — advance by distance. */
  scroll(dz: number): void;
  makeObstacle(kind: ObstacleKind, lane: number): Group;
  makeBolt(): Mesh;
  disposeObstacle(g: Group): void;
}

export function buildWorld(): Kit {
  const scene = new Scene();
  scene.background = gradientTexture([
    [0, SKY_TOP],
    [0.42, "#3C5A66"],
    [0.62, "#C77B57"],
    [0.75, SKY_HORIZON],
    [1, "#F7C98B"],
  ]);
  scene.fog = new Fog(FOG, 26, 120);

  // Sun disk sitting on the horizon.
  const sun = new Mesh(new CircleGeometry(24, 48), new MeshBasicMaterial({ color: "#FFE3A3", fog: false }));
  sun.position.set(-34, -6, -230);
  scene.add(sun);
  const halo = new Mesh(new CircleGeometry(31, 48), new MeshBasicMaterial({ color: "#F7B36E", fog: false }));
  halo.position.set(-34, -6, -232);
  scene.add(halo);

  // Mesas on the salt flat.
  const mesaMat = new MeshLambertMaterial({ color: "#5A3A3E" });
  const mesaFar = new MeshLambertMaterial({ color: "#7A5048" });
  const mesas: Array<[number, number, number, number, Material]> = [
    [-70, -160, 26, 18, mesaMat],
    [-36, -190, 14, 10, mesaFar],
    [44, -150, 30, 14, mesaMat],
    [90, -200, 24, 22, mesaFar],
    [-120, -210, 40, 16, mesaFar],
    [20, -220, 12, 8, mesaFar],
  ];
  for (const [x, z, r, h, m] of mesas) {
    const mesa = new Mesh(new CylinderGeometry(r * 0.78, r, h, 7), m);
    mesa.position.set(x, h / 2 - 2, z);
    scene.add(mesa);
  }
  // Salt flat ground far below the viaduct.
  const flat = new Mesh(new BoxGeometry(800, 1, 600), new MeshLambertMaterial({ color: "#E7B98C" }));
  flat.position.set(0, -12, -200);
  scene.add(flat);

  scene.add(new HemisphereLight("#FFE1C2", "#3A2A3A", 1.7));
  const sunLight = new DirectionalLight("#FFD3A0", 1.5);
  sunLight.position.set(-6, 10, -8);
  scene.add(sunLight);

  // Deck.
  const deck = new Mesh(new BoxGeometry(DECK_W, 0.5, 260), new MeshLambertMaterial({ color: "#4A4F5C" }));
  deck.position.set(0, -0.25, -110);
  scene.add(deck);
  const edgeMat = new MeshLambertMaterial({ color: "#2E323B" });
  for (const side of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(0.28, 0.5, 260), edgeMat);
    rail.position.set(side * (DECK_W / 2 + 0.1), 0.15, -110);
    scene.add(rail);
    const glow = new Mesh(new BoxGeometry(0.06, 0.06, 260), new MeshBasicMaterial({ color: ACCENT }));
    glow.position.set(side * (DECK_W / 2 - 0.02), 0.42, -110);
    scene.add(glow);
  }

  // Lane dashes (instanced, scrolling).
  const dashCount = 2 * 36;
  const dashes = new InstancedMesh(new BoxGeometry(0.1, 0.02, 1.8), new MeshBasicMaterial({ color: "#F3F0E8" }), dashCount);
  const m4 = new Matrix4();
  const dashZ: number[] = [];
  for (let i = 0; i < dashCount / 2; i++) dashZ.push(8 - i * 4.5);
  const writeDashes = () => {
    for (let i = 0; i < dashZ.length; i++) {
      m4.makeTranslation(-LANE / 2, 0.01, dashZ[i]!);
      dashes.setMatrixAt(i * 2, m4);
      m4.makeTranslation(LANE / 2, 0.01, dashZ[i]!);
      dashes.setMatrixAt(i * 2 + 1, m4);
    }
    dashes.instanceMatrix.needsUpdate = true;
  };
  writeDashes();
  dashes.frustumCulled = false;
  scene.add(dashes);

  // Lamp posts and viaduct pillars (scrolling, wrapping). Instanced: 4 draw calls for all of them.
  const lampMat = new MeshLambertMaterial({ color: "#2B2F3A" });
  const bulbMat = new MeshBasicMaterial({ color: "#FFE3A3" });
  const pillarMat = new MeshLambertMaterial({ color: "#3A3E48" });
  const SPAN = 16;
  const COUNT = 9;
  const moverZ: number[] = [];
  for (let i = 0; i < COUNT; i++) moverZ.push(6 - i * SPAN);
  const parts: Array<{ mesh: InstancedMesh; offsets: Array<[number, number]>; y: number }> = [
    { mesh: new InstancedMesh(new BoxGeometry(0.12, 3.2, 0.12), lampMat, COUNT * 2), offsets: [[-(DECK_W / 2 + 0.25), 0], [DECK_W / 2 + 0.25, 0]], y: 1.6 },
    { mesh: new InstancedMesh(new BoxGeometry(0.7, 0.08, 0.12), lampMat, COUNT * 2), offsets: [[-(DECK_W / 2 - 0.05), 0], [DECK_W / 2 - 0.05, 0]], y: 3.2 },
    { mesh: new InstancedMesh(new BoxGeometry(0.34, 0.08, 0.2), bulbMat, COUNT * 2), offsets: [[-(DECK_W / 2 - 0.3), 0], [DECK_W / 2 - 0.3, 0]], y: 3.14 },
    { mesh: new InstancedMesh(new BoxGeometry(2.2, 12, 1.4), pillarMat, COUNT), offsets: [[0, 0]], y: -6.5 },
  ];
  const writeMovers = () => {
    for (const part of parts) {
      let k = 0;
      for (const z of moverZ) {
        for (const [ox, oz] of part.offsets) {
          m4.makeTranslation(ox, part.y, z + oz);
          part.mesh.setMatrixAt(k++, m4);
        }
      }
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  for (const part of parts) {
    part.mesh.frustumCulled = false;
    scene.add(part.mesh);
  }
  writeMovers();

  // Obstacle materials.
  const barTex = stripeTexture(ACCENT, "#F3F0E8");
  const barMat = new MeshLambertMaterial({ map: barTex });
  const legMat = new MeshLambertMaterial({ color: "#2B2F3A" });
  const gateMat = new MeshLambertMaterial({ color: "#20232B" });
  const gateSign = new MeshLambertMaterial({ color: "#F3F0E8", emissive: new Color("#FFE3A3"), emissiveIntensity: 0.15 });
  const crateColors = ["#B5442E", "#2E7D86", "#3A3F7A", "#C98A2E"];
  const crateMats = crateColors.map((c) => new MeshLambertMaterial({ map: corrugatedTexture(c) }));
  const roverMat = new MeshLambertMaterial({ color: "#F3F0E8" });
  const headlight = new MeshBasicMaterial({ color: "#FFF4C2" });
  const boltMat = new MeshLambertMaterial({ color: ACCENT, emissive: new Color(ACCENT), emissiveIntensity: 0.65 });
  const boltGeo = new OctahedronGeometry(0.28, 0);
  let crateIdx = 0;

  return {
    scene,
    scroll(dz) {
      for (let i = 0; i < dashZ.length; i++) {
        let z = dashZ[i]! + dz;
        if (z > 12) z -= dashZ.length * 4.5;
        dashZ[i] = z;
      }
      writeDashes();
      for (let i = 0; i < moverZ.length; i++) {
        let z = moverZ[i]! + dz;
        if (z > 12) z -= COUNT * SPAN;
        moverZ[i] = z;
      }
      writeMovers();
    },
    makeObstacle(kind, lane) {
      const g = new Group();
      const x = (lane - 1) * LANE;
      g.position.x = x;
      if (kind === "bar") {
        const bar = new Mesh(new BoxGeometry(1.5, 0.42, 0.22), barMat);
        bar.position.y = 0.62;
        g.add(bar);
        for (const s of [-1, 1]) {
          const leg = new Mesh(new BoxGeometry(0.1, 0.62, 0.5), legMat);
          leg.position.set(s * 0.62, 0.31, 0);
          g.add(leg);
        }
      } else if (kind === "gate") {
        const sign = new Mesh(new BoxGeometry(1.62, 1.35, 0.2), gateMat);
        sign.position.y = 1.85;
        g.add(sign);
        const face = new Mesh(new BoxGeometry(1.4, 0.34, 0.04), gateSign);
        face.position.set(0, 1.38, 0.12);
        g.add(face);
        const arrow = new Mesh(new BoxGeometry(0.5, 0.1, 0.04), barMat);
        arrow.position.set(0, 2.15, 0.12);
        g.add(arrow);
        for (const s of [-1, 1]) {
          const post = new Mesh(new BoxGeometry(0.12, 2.5, 0.12), legMat);
          post.position.set(s * 0.82, 1.25, 0);
          g.add(post);
        }
      } else {
        const len = kind === "rover" ? 2.4 : 3.4;
        const box = new Mesh(new BoxGeometry(1.5, kind === "rover" ? 1.5 : 2.3, len), kind === "rover" ? roverMat : crateMats[crateIdx++ % crateMats.length]!);
        box.position.y = kind === "rover" ? 0.95 : 1.15;
        g.add(box);
        if (kind === "rover") {
          for (const s of [-1, 1]) {
            const lamp = new Mesh(new BoxGeometry(0.3, 0.16, 0.05), headlight);
            lamp.position.set(s * 0.45, 0.7, len / 2 + 0.01);
            g.add(lamp);
          }
          const stripe = new Mesh(new BoxGeometry(1.52, 0.18, len + 0.02), barMat);
          stripe.position.y = 1.2;
          g.add(stripe);
        }
      }
      g.userData.kind = kind;
      return g;
    },
    makeBolt() {
      return new Mesh(boltGeo, boltMat);
    },
    disposeObstacle(g) {
      g.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
      g.removeFromParent();
    },
  };
}
