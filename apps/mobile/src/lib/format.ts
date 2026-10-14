import { formatScore } from "@thumbcade/protocol";

export interface LooseScoreConfig {
  format?: "integer" | "ms" | undefined;
  unit?: string | undefined;
}

/** formatScore for DB rows whose score_config may omit defaults. */
export function fmtScore(score: number, cfg?: LooseScoreConfig | null): string {
  return formatScore(score, { format: cfg?.format ?? "integer", ...(cfg?.unit ? { unit: cfg.unit } : null) });
}
