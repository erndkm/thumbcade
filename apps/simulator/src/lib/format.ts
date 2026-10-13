export function formatMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function compactJson(v: unknown, max = 160): string {
  if (v === undefined) return "";
  let s: string;
  try {
    s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
