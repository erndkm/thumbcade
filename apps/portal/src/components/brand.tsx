import Link from "next/link";
import { cx } from "./ui";

export function Lockup({ className, height = 28 }: { className?: string; height?: number }) {
  return (
    <Link href="/" className={cx("inline-flex items-center", className)} aria-label="Thumbcade home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/lockup.svg" alt="thumbcade" style={{ height }} className="w-auto" />
    </Link>
  );
}

export function Mark({ size = 32, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/mark.svg" alt="" width={size} height={size} className={className} />;
}
