/** SDK release. Hosts read it from the `hello` message. */
export const SDK_VERSION = "1.0.0";
/** Marker that lets both sides ignore unrelated postMessage traffic. */
export const CHANNEL = "tc";
/** Bridge protocol version (the `v` field of every envelope). */
export const PROTOCOL_VERSION = 1;

/** Pointer travel (CSS px) above which a pointer sequence counts as a swipe, not a tap. */
export const TAP_SLOP = 12;
/** How long a finished pointer sequence or key press still counts as "the input that started the run". */
export const TRIGGER_WINDOW_MS = 1000;
/** Requests that get no reply within this window reject with code "unavailable". */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Hello is re-sent at this interval until the host answers. */
export const HELLO_RETRY_MS = 250;
/** Inside an iframe with no Thumbcade host (e.g. embedded elsewhere), fall back to standalone after this long. */
export const IFRAME_FALLBACK_MS = 5000;

export const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
export const STORAGE_VALUE_MAX_BYTES = 16 * 1024;

export const ANALYTICS_EVENTS = [
  "level_start",
  "level_complete",
  "level_fail",
  "tutorial_complete",
  "powerup_used",
  "milestone",
] as const;
export const ANALYTICS_PER_SECOND = 10;
