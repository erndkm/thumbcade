/**
 * @thumbcade/sdk — the only API a Thumbcade game ever sees.
 *
 *   import { thumbcade as tc } from "@thumbcade/sdk";
 *   const ctx = await tc.init();
 *   tc.ready();
 */
import { createThumbcade, type Thumbcade } from "./sdk.ts";

export { createThumbcade } from "./sdk.ts";
export type { InitOptions, Thumbcade } from "./sdk.ts";
export type { LoopCallback, LoopHandle, LoopOptions } from "./loop.ts";
export type { TransportKind } from "./transport.ts";
export { SDK_VERSION } from "./constants.ts";
export { INJECTED_CSS } from "./css.ts";
export type * from "./types.ts";

/** The SDK singleton for this page. */
export const thumbcade: Thumbcade = createThumbcade(window);
export { thumbcade as tc };
export default thumbcade;
