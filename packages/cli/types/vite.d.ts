import type { Plugin } from "vite";

/**
 * The Vite plugin every Thumbcade game uses: relative base, no inline scripts, validates and ships
 * thumbcade.json, serves it in dev.
 */
export declare function thumbcade(): Plugin;
export default thumbcade;
