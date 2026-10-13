import type { Metadata } from "next";
import { Mark } from "@/components/brand";
import { EmptyState } from "@/components/ui";
import { requireViewer } from "@/lib/auth";
import { ActivateForm } from "./activate-form";

export const metadata: Metadata = { title: "Connect the CLI" };

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const viewer = await requireViewer(`/cli/activate${code ? `?code=${encodeURIComponent(code)}` : ""}`);
  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-8 pt-6">
      <Mark size={56} />
      <header className="flex flex-col gap-3">
        <span className="label">thumbcade login</span>
        <h1 className="display text-[clamp(36px,5vw,56px)] text-text">Connect your terminal.</h1>
        <p className="text-[16px] leading-6 text-text-dim">
          Check that the code matches the one in your terminal. Approving creates an API token for <strong className="text-text">@{viewer.handle}</strong> that can publish your
          games.
        </p>
      </header>
      {viewer.role === "user" ? (
        <EmptyState title="Become a creator first." body="Set up your creator handle on the Games page, then run thumbcade login again." />
      ) : (
        <ActivateForm initialCode={code ?? ""} />
      )}
    </div>
  );
}
