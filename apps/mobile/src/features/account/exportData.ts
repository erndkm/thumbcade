import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { exportAccount } from "../../lib/api";

/** Fetches the server-side export (account-export) and hands it to the share sheet as JSON. */
export async function exportMyData(): Promise<void> {
  const doc = await exportAccount();
  const file = new File(Paths.cache, `thumbcade-export-${new Date().toISOString().slice(0, 10)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(doc, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Your Thumbcade data", UTI: "public.json" });
}
