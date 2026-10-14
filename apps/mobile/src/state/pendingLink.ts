let pending: string | null = null;
/** A deep link that arrived before onboarding finished; opened right after. */
export function setPendingHref(href: string): void {
  pending = href;
}
export function takePendingHref(): string | null {
  const h = pending;
  pending = null;
  return h;
}
