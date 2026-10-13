import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/creator";
  if (await getViewer()) redirect(safeNext);
  return (
    <section className="mx-auto grid min-h-[calc(100dvh-64px)] max-w-[1280px] items-center gap-16 px-4 py-16 md:px-8 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <span className="label">Members & creators</span>
        <h1 className="display text-[clamp(48px,7vw,104px)] text-text">
          Sign in.
          <br />
          <span className="text-text-mute">Keep score.</span>
        </h1>
        <p className="max-w-[440px] text-[17px] leading-7 text-text-dim">
          One account for the app and the web: your likes, saves and best scores follow you. Creators get the dashboard, API tokens and
          review status.
        </p>
      </div>
      <div className="w-full max-w-[440px] lg:justify-self-end">
        <LoginForm next={safeNext} />
      </div>
    </section>
  );
}
