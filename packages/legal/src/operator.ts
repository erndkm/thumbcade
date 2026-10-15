/**
 * The company that runs Thumbcade. Shown in the Imprint and named as the controller in the Privacy
 * Policy. Bracketed values are placeholders and must be replaced before launch. Optional fields
 * (`phone`, `register`, `vatId`) are left out of the Imprint when null.
 */
export const OPERATOR = {
  /** Full legal name including the legal form, e.g. "Thumbcade GmbH". */
  name: "[Company name and legal form]",
  /** Street address that can receive legal mail (no P.O. box). */
  address: ["[Street and number]", "[Postcode and city]", "Germany"],
  /** Managing director(s) or owner. Null for a sole trader whose name is `name`. */
  representedBy: "[Managing director]" as string | null,
  phone: "[Phone number]" as string | null,
  /** Commercial register entry, if registered. */
  register: { court: "[Register court]", number: "[Register number]" } as { court: string; number: string } | null,
  vatId: "[VAT ID]" as string | null,
  email: {
    general: "hello@thumbcade.com",
    privacy: "privacy@thumbcade.com",
    safety: "safety@thumbcade.com",
  },
} as const;

/**
 * Retention periods stated in the Privacy Policy. The first two are enforced by pg_cron
 * (supabase/migrations/*_data_retention.sql; a test keeps the numbers equal). Logs and backups
 * are upper bounds the hosting setup must stay within.
 */
export const RETENTION = {
  /** Raw usage events (impressions, plays, skips…). Only daily aggregates are kept after this. */
  usageEventsDays: 90,
  /** Guest accounts nobody has opened for this long are deleted with everything in them. */
  inactiveGuestMonths: 12,
  /** Request logs at our hosting providers. */
  serverLogsDays: 30,
  /** Database backups roll over within this window after a deletion. */
  backupsDays: 30,
} as const;

/** True while any operator field still holds a placeholder. */
export function operatorHasPlaceholders(): boolean {
  return /\[[^\]]+\]/.test(JSON.stringify(OPERATOR));
}
