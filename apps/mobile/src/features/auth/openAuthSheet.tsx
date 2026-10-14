import { openSheet } from "../../state/sheets";
import { AuthSheet } from "./AuthSheet";

export function openAuthSheet(opts: { reason?: string; onSignedIn?: () => void } = {}): void {
  openSheet({
    key: "auth",
    snap: 0.78,
    keyboard: true,
    accessibilityLabel: "Sign up",
    render: (close) => (
      <AuthSheet
        reason={opts.reason}
        onClose={close}
        onDone={() => {
          close();
          // Let the sheet animate away before the deferred action runs.
          if (opts.onSignedIn) setTimeout(opts.onSignedIn, 260);
        }}
      />
    ),
  });
}
