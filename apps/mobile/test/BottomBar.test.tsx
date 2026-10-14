import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomBar } from "../src/feed/BottomBar";

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const wrap = (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

const dock = { liked: false, onLike: jest.fn(), muted: true, onToggleMute: jest.fn(), onMore: jest.fn() };

describe("BottomBar", () => {
  it("is the tab bar outside play, with the five tabs and the active one selected", async () => {
    const onTab = jest.fn();
    await wrap(<BottomBar active="home" mode="tabbar" onTab={onTab} dock={dock} inboxBadge={3} />);
    expect(screen.getByTestId("tabbar")).toBeTruthy();
    expect(screen.queryByTestId("dock")).toBeNull();
    for (const t of ["home", "discover", "create", "inbox", "me"]) expect(screen.getByTestId(`tab-${t}`)).toBeTruthy();
    expect(screen.getByTestId("tab-home").props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText("Inbox, 3 new")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("tab-discover"));
    expect(onTab).toHaveBeenCalledWith("discover");
  });

  it("morphs into the Dock while playing, with like, mute and more", async () => {
    await wrap(<BottomBar active="home" mode="dock" onTab={jest.fn()} dock={dock} accent="#FF6A1A" />);
    expect(screen.getByTestId("dock")).toBeTruthy();
    expect(screen.queryByTestId("tabbar")).toBeNull();
    await fireEvent.press(screen.getByTestId("dock-like"));
    await fireEvent.press(screen.getByTestId("dock-mute"));
    await fireEvent.press(screen.getByTestId("dock-more"));
    expect(dock.onLike).toHaveBeenCalled();
    expect(dock.onToggleMute).toHaveBeenCalled();
    expect(dock.onMore).toHaveBeenCalled();
    expect(screen.getByLabelText("Sound on")).toBeTruthy();
  });

  it("plays the coach only in Dock mode when asked", async () => {
    const shown = jest.fn();
    await wrap(<BottomBar active="home" mode="tabbar" onTab={jest.fn()} dock={dock} coach onCoachShown={shown} />);
    expect(screen.queryByTestId("dock-coach")).toBeNull();
    expect(shown).not.toHaveBeenCalled();
  });

  it("shows the coach over the Dock", async () => {
    const shown = jest.fn();
    await wrap(<BottomBar active="home" mode="dock" onTab={jest.fn()} dock={dock} coach onCoachShown={shown} />);
    expect(screen.getByTestId("dock-coach")).toBeTruthy();
    expect(screen.getByText("Swipe here for next")).toBeTruthy();
    expect(shown).toHaveBeenCalledTimes(1);
  });
});
