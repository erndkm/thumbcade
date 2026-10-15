import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Account deleted", robots: { index: false } };

export default function AccountDeleted() {
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[760px] flex-col justify-center gap-6 px-4 py-16">
      <span className="label">Account deleted</span>
      <h1 className="display text-[clamp(40px,6vw,80px)] text-text">Game over.</h1>
      <p className="max-w-[480px] text-[17px] leading-7 text-text-dim">
        Your account and everything tied to it are gone. Thanks for playing. You can still play without an account anytime.
      </p>
      <ButtonLink href="/play" className="self-start">
        Play without an account
      </ButtonLink>
    </section>
  );
}
