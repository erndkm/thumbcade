import { zipSync, type Zippable } from "fflate";
import type { BundleFile } from "./checks/index.ts";

/** Zips a bundle (paths relative to the bundle root, thumbcade.json at the root). */
export function zipBundle(files: BundleFile[]): Uint8Array {
  const tree: Zippable = {};
  for (const f of files) tree[f.path] = [new Uint8Array(f.data), { level: /\.(png|jpe?g|webp|avif|woff2?|mp3|ogg|m4a|mp4|webm|glb)$/i.test(f.path) ? 0 : 9 }];
  return zipSync(tree);
}
