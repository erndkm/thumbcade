import { router } from "expo-router";
import type { FeedCard } from "@thumbcade/protocol";
import { openSheet } from "../../state/sheets";
import { useAuth } from "../../state/auth";
import { SheetDragArea } from "../../ui/Sheet";
import { SheetRow, SheetTitle } from "../../ui/SheetRow";
import { blockUser, requireMember } from "../social";
import { openShareSheet } from "../share/openShareSheet";
import { openReportSheet } from "../report/openReportSheet";

/** "More" from the Dock or the game page: game page, share, report, block. */
export function openMoreSheet(card: FeedCard, lastScore: number | null = null): void {
  const mine = useAuth.getState().userId === card.creator.id;
  openSheet({
    key: "more",
    snap: 0.46,
    accessibilityLabel: "More options",
    render: (close) => (
      <>
        <SheetDragArea>
          <SheetTitle>{card.game.name}</SheetTitle>
        </SheetDragArea>
        <SheetRow
          icon="grid"
          label="Game page"
          hint="Leaderboards, version notes, more from the creator"
          testID="more-game-page"
          onPress={() => {
            close();
            router.push(`/game/${card.game.slug}`);
          }}
        />
        <SheetRow
          icon="share"
          label="Share"
          onPress={() => {
            close();
            setTimeout(() => openShareSheet(card, lastScore), 250);
          }}
        />
        {mine ? null : (
          <>
            <SheetRow
              icon="flag"
              label="Report this game"
              testID="more-report"
              onPress={() => {
                close();
                setTimeout(() => requireMember("Sign up to report games.", () => openReportSheet("game", card.game.id, card.game.name)), 250);
              }}
            />
            <SheetRow
              icon="lock"
              label={`Block @${card.creator.handle}`}
              hint="Their games and comments disappear for you"
              danger
              onPress={() => {
                close();
                setTimeout(() => requireMember("Sign up to block creators.", () => void blockUser(card.creator.id, card.creator.handle)), 250);
              }}
            />
          </>
        )}
      </>
    ),
  });
}
