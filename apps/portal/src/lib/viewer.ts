import "server-only";
import type { WebViewer } from "@/components/web-feed/types";
import { getViewer } from "./auth";

export async function getWebViewer(): Promise<WebViewer | null> {
  const v = await getViewer();
  return v ? { id: v.id, handle: v.handle, displayName: v.displayName, avatarUrl: v.avatarUrl } : null;
}
