import { Tabs } from "expo-router";
import { BottomBar, type TabKey } from "../../src/feed/BottomBar";
import { useUnreadCount } from "../../src/hooks/useUnread";
import { c } from "../../src/ui/theme";

const ROUTE_TO_TAB: Record<string, TabKey> = { index: "home", discover: "discover", create: "create", inbox: "inbox", me: "me" };
const TAB_TO_ROUTE: Record<TabKey, string> = { home: "index", discover: "discover", create: "create", inbox: "inbox", me: "me" };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, lazy: true, animation: "none" }}
      tabBar={(props) => {
        const route = props.state.routes[props.state.index];
        // Home renders its own bar so the Dock can drive the pager directly.
        if (!route || route.name === "index") return null;
        return <AppTabBar active={ROUTE_TO_TAB[route.name] ?? "home"} onTab={(t) => props.navigation.navigate(TAB_TO_ROUTE[t])} />;
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

function AppTabBar({ active, onTab }: { active: TabKey; onTab: (t: TabKey) => void }) {
  const unread = useUnreadCount();
  return <BottomBar active={active} onTab={onTab} mode="tabbar" inboxBadge={unread} />;
}
