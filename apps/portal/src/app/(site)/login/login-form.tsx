"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { Button, Field, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

export function LoginForm({ next }: { next: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (err) return setError(err.message.includes("rate") ? "Too many codes requested. Wait a minute and try again." : "We couldn't send a code to that address.");
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (err) return setError("That code didn't work. Check the latest email, or request a new one.");
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="rounded-[28px] border border-line bg-surface p-7 sm:p-9">
      {step === "email" ? (
        <form onSubmit={sendCode} className="flex flex-col gap-6">
          <div>
            <h2 className="font-wide text-[24px] font-extrabold tracking-tight text-text">Get a sign-in code</h2>
            <p className="mt-1 text-[15px] text-text-dim">No password. We email you six digits.</p>
          </div>
          <Field label="Email">
            <Input type="email" required autoComplete="email" placeholder="you@studio.dev" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          {error ? <p className="text-[14px] text-heat">{error}</p> : null}
          <Button type="submit" size="lg" disabled={busy || !email.includes("@")}>
            {busy ? "Sending…" : "Email me a code"}
          </Button>
          <p className="text-[13px] leading-5 text-text-mute">
            By continuing you agree to the{" "}
            <Link href="/legal/terms" className="underline hover:text-text">
              Terms
            </Link>{" "}
            and confirm you&apos;ve read the{" "}
            <Link href="/legal/privacy" className="underline hover:text-text">
              Privacy Policy
            </Link>
            . Accounts are for ages 13 and up.
          </p>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-6">
          <button type="button" onClick={() => setStep("email")} className="flex items-center gap-1 self-start text-[14px] text-text-dim hover:text-text">
            <Icon name="back" size={16} /> {email}
          </button>
          <div>
            <h2 className="font-wide text-[24px] font-extrabold tracking-tight text-text">Check your inbox</h2>
            <p className="mt-1 text-[15px] text-text-dim">Enter the 6-digit code we just sent. It expires in an hour.</p>
          </div>
          <Field label="Code">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="font-mono text-[28px] tracking-[0.5em]"
              autoFocus
            />
          </Field>
          {error ? <p className="text-[14px] text-heat">{error}</p> : null}
          <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}
