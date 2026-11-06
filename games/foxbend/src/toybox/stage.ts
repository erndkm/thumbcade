import type {
  Object3D} from "three";
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MeshLambertMaterial,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { P } from "./palette.ts";

/** The camera sits up and to the front-right: true isometric (35.26° down, 45° around). */
export const ISO = new Vector3(1, 1, 1).normalize();
/** Toward the sun: high, from the back-left, so tops are brightest, left faces mid, right faces darkest. */
export const SUN = new Vector3(-0.42, 1, 0.62).normalize();
/** Ground directions as they appear on screen. */
export const SCREEN_UP = new Vector3(-1, 0, -1).normalize();
export const SCREEN_RIGHT = new Vector3(1, 0, -1).normalize();

const CAM_DIST = 60;

export interface StageOptions {
  /** World units across the screen on a phone. */
  viewW: number;
  /** Fog: depth beyond the focus point where the haze starts and where it's full. */
  fog?: [number, number];
  shadowSize?: number;
  shadowExtent?: number;
}

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  sun: DirectionalLight;
  /** Shared vertex-colored Lambert material for every voxel model. */
  vox: MeshLambertMaterial;
  /** Overlay scene in screen pixels (title sign and other UI props), same iso orientation, no shadows. */
  ui: { scene: Scene; camera: OrthographicCamera; place(o: Object3D, x: number, y: number, pxPerUnit: number): void };
  width: number;
  height: number;
  dpr: number;
  /** Screen pixels per world unit. */
  ppu: number;
  focus: Vector3;
  look(target: Vector3): void;
  setView(viewW: number): void;
  toScreen(p: Vector3, out?: { x: number; y: number }): { x: number; y: number };
  onResize(cb: (w: number, h: number) => void): void;
  render(): void;
}

export function createStage(opts: StageOptions): Stage {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(new Color(P.haze), 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.autoClear = false;
  const el = renderer.domElement;
  el.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  document.body.appendChild(el);

  const scene = new Scene();
  if (opts.fog) scene.fog = new Fog(new Color(P.haze), CAM_DIST + opts.fog[0], CAM_DIST + opts.fog[1]);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, CAM_DIST * 2.5);
  camera.position.copy(ISO).multiplyScalar(CAM_DIST);
  camera.lookAt(0, 0, 0);

  const hemi = new HemisphereLight(new Color("#FFF6EA"), new Color("#B9A9DE"), 1.8);
  scene.add(hemi);
  const sun = new DirectionalLight(new Color("#FFF0DA"), 2.6);
  sun.castShadow = true;
  const sz = opts.shadowSize ?? 2048;
  sun.shadow.mapSize.set(sz, sz);
  const ext = opts.shadowExtent ?? 16;
  const sc = sun.shadow.camera;
  sc.left = -ext;
  sc.right = ext;
  sc.top = ext;
  sc.bottom = -ext;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.intensity = 0.5;
  sun.shadow.radius = 2.5;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const vox = new MeshLambertMaterial({ vertexColors: true });

  // UI overlay scene in pixel units.
  const uiScene = new Scene();
  uiScene.add(new HemisphereLight(new Color("#FFF6EA"), new Color("#B9A9DE"), 1.8));
  const uiSun = new DirectionalLight(new Color("#FFF0DA"), 2.6);
  uiSun.position.copy(SUN).multiplyScalar(100);
  uiScene.add(uiSun, uiSun.target);
  const uiCam = new OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  uiCam.quaternion.copy(camera.quaternion);
  uiCam.updateMatrixWorld();
  const camRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const camUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

  const focus = new Vector3();
  const lightRight = new Vector3().crossVectors(new Vector3(0, 1, 0), SUN).normalize();
  const lightUp = new Vector3().crossVectors(SUN, lightRight).normalize();
  const snapped = new Vector3();
  const listeners: Array<(w: number, h: number) => void> = [];
  let viewW = opts.viewW;
  const v = new Vector3();

  const stage: Stage = {
    renderer,
    scene,
    camera,
    sun,
    vox,
    ui: {
      scene: uiScene,
      camera: uiCam,
      place(o, x, y, pxPerUnit) {
        o.position.copy(camRight).multiplyScalar(x).addScaledVector(camUp, -y);
        o.scale.setScalar(pxPerUnit);
      },
    },
    width: 0,
    height: 0,
    dpr: 1,
    ppu: 40,
    focus,
    look(target) {
      focus.copy(target);
      camera.position.copy(target).addScaledVector(ISO, CAM_DIST);
      camera.updateMatrixWorld();
      // Snap the shadow camera to whole texels so shadow edges don't shimmer while the view glides.
      const texel = (2 * ext) / sz;
      const a = Math.round(target.dot(lightRight) / texel) * texel;
      const b = Math.round(target.dot(lightUp) / texel) * texel;
      const c = target.dot(SUN);
      snapped.copy(lightRight).multiplyScalar(a).addScaledVector(lightUp, b).addScaledVector(SUN, c);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(SUN, 45);
      sun.target.updateMatrixWorld();
    },
    setView(w) {
      viewW = w;
      fit();
    },
    toScreen(p, out = { x: 0, y: 0 }) {
      v.copy(p).project(camera);
      out.x = (v.x * 0.5 + 0.5) * stage.width;
      out.y = (-v.y * 0.5 + 0.5) * stage.height;
      return out;
    },
    onResize(cb) {
      listeners.push(cb);
    },
    render() {
      renderer.clear();
      renderer.render(scene, camera);
      if (uiScene.children.length > 3) {
        renderer.clearDepth();
        renderer.render(uiScene, uiCam);
      }
    },
  };

  function fit() {
    const W = stage.width;
    const H = stage.height;
    // Phones: a fixed world width. Wider screens (tablets, desktop): keep the portrait framing.
    const ppu = Math.min(W, H * 0.6) / viewW;
    stage.ppu = ppu;
    camera.left = -W / 2 / ppu;
    camera.right = W / 2 / ppu;
    camera.top = H / 2 / ppu;
    camera.bottom = -H / 2 / ppu;
    camera.updateProjectionMatrix();
    uiCam.left = 0;
    uiCam.right = W;
    uiCam.top = 0;
    uiCam.bottom = -H;
    uiCam.updateProjectionMatrix();
  }

  const resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === stage.width && h === stage.height && dpr === stage.dpr) return;
    stage.width = w;
    stage.height = h;
    stage.dpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    fit();
    listeners.forEach((l) => l(w, h));
  };
  resize();
  window.addEventListener("resize", resize);
  return stage;
}
