import { act, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Gesture } from "react-native-gesture-handler";
import { CardView } from "../src/feed/CardView";
import { boot, card, harness } from "./helpers";

jest.mock("../src/feed/LikeBurst", () => {
  const { forwardRef } = jest.requireActual("react");
  return { LikeBurst: forwardRef(() => null) };
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function renderCard(h: ReturnType<typeof harness>, vertical = false) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <CardView card={card(vertical)} controller={h.ctl} native={Gesture.Native()} live active width={390} height={754} safeTop={47} />
    </SafeAreaProvider>,
  );
}

const overlayHidden = () => {
  type Node = { props: { pointerEvents?: string }; parent: Node | null };
  let node = screen.getByTestId("action-rail") as unknown as Node | null;
  while (node) {
    if (node.props.pointerEvents === "none") return true;
    node = node.parent;
  }
  return false;
};

describe("CardView overlay states", () => {
  it("LOADING: poster + full overlay, the game is mounted behind it", async () => {
    const h = harness();
    h.ctl.loadStarted();
    h.ctl.activate();
    await renderCard(h);
    expect(screen.getByTestId("webview")).toBeTruthy();
    expect(screen.getByTestId("action-rail")).toBeTruthy();
    expect(screen.getByLabelText("Duskrail, loading")).toBeTruthy();
    expect(overlayHidden()).toBe(false);
  });

  it("PREVIEW: full overlay with caption and rail", async () => {
    const h = harness();
    await boot(h);
    await renderCard(h);
    expect(screen.getByLabelText("Duskrail, preview")).toBeTruthy();
    expect(screen.getByTestId("caption-name")).toHaveTextContent("Duskrail");
    expect(overlayHidden()).toBe(false);
  });

  it("PLAYING: the overlay recedes and stops taking touches", async () => {
    const h = harness();
    await boot(h);
    await renderCard(h);
    await act(async () => h.game("gameplay.start", { trigger: "tap" }));
    expect(screen.getByLabelText("Duskrail, playing")).toBeTruthy();
    expect(overlayHidden()).toBe(true);
    expect(screen.queryByTestId("result-card")).toBeNull();
  });

  it("ENDED: result card with score, replay and challenge", async () => {
    const h = harness({ best: 10 });
    await boot(h);
    await renderCard(h);
    await act(async () => {
      h.game("gameplay.start", { trigger: "tap" });
      h.game("gameplay.end", { score: 120 });
      await h.flush();
      await h.flush();
    });
    expect(screen.getByTestId("result-card")).toBeTruthy();
    expect(screen.getByTestId("result-replay")).toBeTruthy();
    expect(screen.getByTestId("result-challenge")).toBeTruthy();
    expect(screen.getByTestId("new-best")).toBeTruthy();
    expect(screen.getByText(/Top 9% today/)).toBeTruthy();
    expect(overlayHidden()).toBe(false);
  });

  it("PAUSED: resume pill over the game", async () => {
    const h = harness();
    await boot(h);
    await renderCard(h);
    await act(async () => {
      h.game("gameplay.start", { trigger: "tap" });
      h.ctl.dispatch({ type: "PAUSE", reason: "back" });
    });
    expect(screen.getByTestId("resume-pill")).toBeTruthy();
    expect(overlayHidden()).toBe(false);
  });

  it("FAILED: the retry affordance with voice", async () => {
    const h = harness();
    h.ctl.loadStarted();
    h.ctl.activate();
    await renderCard(h);
    await act(async () => h.advance(8_001));
    expect(screen.getByTestId("card-failed")).toBeTruthy();
    expect(screen.getByText("That game tripped over a cable.")).toBeTruthy();
  });
});
