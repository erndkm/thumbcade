import { OPERATOR, RETENTION } from "@thumbcade/legal";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DeleteForm } from "./delete-form";

export const metadata: Metadata = { title: "Account" };

const AGE_BAND = { under13: "Under 13", "13to15": "13–15", "16to17": "16–17", adult: "18+" } as const;
const ROLE = { user: "Player", creator: "Creator", admin: "Admin" } as const;
const PROVIDER: Record<string, string> = { email: "Email code", apple: "Apple", google: "Google" };
const date = (iso: string | undefined) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)) : "—");

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ export?: string }> }) {
  const viewer = await requireViewer("/account");
  const [{ export: exported }, supabase] = await Promise.all([searchParams, createClient()]);
  const [{ data: auth }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("age_band, created_at").eq("id", viewer.id).single(),
  ]);
  const methods = [...new Set((auth.user?.identities ?? []).map((i) => PROVIDER[i.provider] ?? i.provider))];
  const facts: [string, string][] = [
    ["Email", viewer.email ?? "—"],
    ["Handle", `@${viewer.handle}`],
    ["Display name", viewer.displayName],
    ["Account type", ROLE[viewer.role]],
    ["Signs in with", methods.join(", ") || "—"],
    ["Age range", profile?.age_band ? AGE_BAND[profile.age_band] : "Not set"],
    ["Member since", date(profile?.created_at ?? auth.user?.created_at)],
  ];

  return (
    <div className="flex max-w-[960px] flex-col gap-12">
      <header className="flex flex-col gap-3">
        <span className="label">Your data</span>
        <h1 className="display text-[clamp(36px,5vw,64px)] text-text">Account</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-text-dim">
          What Thumbcade stores about you, a full copy to download, and the way out. The{" "}
          <Link href="/legal/privacy" className="text-text underline">
            Privacy Policy
          </Link>{" "}
          explains why we keep each piece.
        </p>
      </header>

      <section className="rule-t flex flex-col gap-6 pt-8">
        <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Your account</h2>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1">
              <dt className="label">{label}</dt>
              <dd className="truncate text-[15px] text-text">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="max-w-[560px] text-[14px] leading-6 text-text-mute">
          Change your handle, name, photo and bio in the app under Settings → Edit profile. To correct anything else, write to{" "}
          <a href={`mailto:${OPERATOR.email.privacy}`} className="text-text-dim underline hover:text-text">
            {OPERATOR.email.privacy}
          </a>
          .
        </p>
      </section>

      <section className="rule-t flex flex-col gap-4 pt-8">
        <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Download your data</h2>
        <p className="max-w-[560px] text-[15px] leading-6 text-text-dim">
          One JSON file with everything we store about your account: profile and sign-in methods, follows, likes, saves, comments, reports,
          scores, game saves, notifications, your activity from the last {RETENTION.usageEventsDays} days and, if you publish, your games and
          API tokens.
        </p>
        <form action="/account/export" method="get">
          <Button type="submit" variant="secondary">
            Download my data
          </Button>
        </form>
        {exported === "failed" ? <p className="text-[14px] text-heat">The export failed. Try again in a moment.</p> : null}
      </section>

      <section className="rule-t flex flex-col gap-4 pt-8">
        <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Delete account</h2>
        <p className="max-w-[560px] text-[15px] leading-6 text-text-dim">
          Permanently deletes your profile, scores, likes, saves, comments, follows, game saves and activity
          {viewer.role === "user" ? "" : ", and every game you published with its builds"}. It happens immediately and can&apos;t be undone.
        </p>
        <DeleteForm />
      </section>
    </div>
  );
}
