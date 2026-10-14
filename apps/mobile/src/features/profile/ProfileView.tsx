import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { formatCount } from "@thumbcade/protocol";
import { useProfile, useProfileTab, type ProfileTab } from "../../hooks/data";
import { useMe } from "../../hooks/useMe";
import { useAuth } from "../../state/auth";
import { openSheet } from "../../state/sheets";
import { fmtScore } from "../../lib/format";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { EmptyState, ErrorState } from "../../ui/EmptyState";
import { Icon } from "../../ui/Icon";
import { PosterGrid, PosterGridSkeleton } from "../../ui/PosterTile";
import { Header, IconButton, Screen } from "../../ui/Screen";
import { Segmented } from "../../ui/Segmented";
import { SheetDragArea } from "../../ui/Sheet";
import { SheetRow, SheetTitle } from "../../ui/SheetRow";
import { Skeleton } from "../../ui/Skeleton";
import { T } from "../../ui/Text";
import { c, layout, radius, space } from "../../ui/theme";
import { openAuthSheet } from "../auth/openAuthSheet";
import { blockUser, requireMember, setFollow, unblockUser } from "../social";
import { openReportSheet } from "../report/openReportSheet";

export function ProfileView({ handle, self }: { handle: string; self?: boolean }) {
  const { width } = useWindowDimensions();
  const myId = useAuth((s) => s.userId);
  const isGuest = useAuth((s) => s.isGuest);
  const q = useProfile(handle);
  const p = q.data;
  const isMe = !!p && p.id === myId;
  const tabs = useMemo(() => {
    const t: { key: ProfileTab; label: string }[] = [];
    if (p && (p.role === "creator" || p.role === "admin" || p.game_count > 0)) t.push({ key: "games", label: "Games" });
    t.push({ key: "liked", label: "Liked" });
    if (isMe && !isGuest) t.push({ key: "saved", label: "Saved" });
    t.push({ key: "best", label: "Best scores" });
    return t;
  }, [p, isMe, isGuest]);
  const [tab, setTab] = useState<ProfileTab | null>(null);
  const activeTab = tab ?? tabs[0]?.key ?? "liked";
  const grid = useProfileTab(p?.id, activeTab);

  return (
    <Screen testID={isMe ? "my-profile" : "profile"}>
      <Header
        back={!self}
        title={p ? `@${p.handle}` : ""}
        right={
          isMe ? (
            <IconButton icon="settings" label="Settings" testID="open-settings" onPress={() => router.push("/settings")} />
          ) : p ? (
            <IconButton icon="more" label="More" onPress={() => openProfileMore(p.id, p.handle, p.blocked)} />
          ) : null
        }
      />
      {q.isPending ? (
        <ProfileSkeleton width={width} />
      ) : q.isError ? (
        <ErrorState what="This profile" onRetry={() => void q.refetch()} />
      ) : !p ? (
        <EmptyState icon="profile" title="Nobody by that name." body="This account was deleted or the handle changed." action="Back to the feed" onAction={() => router.replace("/")} />
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void Promise.all([q.refetch(), grid.refetch()])} tintColor={c.textDim} />} contentContainerStyle={{ paddingBottom: space[16] }}>
          <View style={{ paddingHorizontal: layout.gutter, gap: space[3], paddingTop: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[4] }}>
              <Avatar seed={p.avatar_seed} url={p.avatar_url} size={layout.avatar.xl} />
              <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }}>
                <Count value={p.following_count} label="Following" />
                <Count value={p.follower_count} label="Followers" />
                <Count value={p.likes_received} label="Likes" />
              </View>
            </View>
            <View style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <T variant="title" numberOfLines={1} testID="profile-name">
                  {p.display_name}
                </T>
                {p.verified ? (
                  <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: c.text, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Verified">
                    <Icon name="check" size={12} color={c.bg} strokeWidth={3} />
                  </View>
                ) : null}
                {p.role === "creator" ? (
                  <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <T variant="monoLabel" color="textDim">
                      Creator
                    </T>
                  </View>
                ) : null}
              </View>
              {p.bio ? (
                <T variant="body" color="textDim">
                  {p.bio}
                </T>
              ) : isMe ? (
                <T variant="body" color="textDim">
                  No bio yet. Tell people what you're great at.
                </T>
              ) : null}
            </View>
            {isMe ? (
              isGuest ? (
                <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: radius.sheetInner, padding: space[4], gap: space[3], backgroundColor: c.surface }}>
                  <T variant="headline">You're playing as a guest.</T>
                  <T variant="body" color="textDim">
                    Sign up to keep your scores, follow creators and get on the leaderboards. Your runs so far come with you.
                  </T>
                  <Button testID="profile-signup" label="Sign up" onPress={() => openAuthSheet()} />
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: space[2] }}>
                  <Button label="Edit profile" kind="secondary" small onPress={() => router.push("/settings/account")} style={{ flex: 1 }} />
                  <Button label="Settings" kind="ghost" small icon="settings" onPress={() => router.push("/settings")} />
                </View>
              )
            ) : p.blocked ? (
              <Button label={`Unblock @${p.handle}`} kind="secondary" onPress={() => void unblockUser(p.id).then(() => q.refetch())} />
            ) : (
              <Button
                testID="profile-follow"
                label={p.following ? "Following" : p.followsMe ? "Follow back" : "Follow"}
                kind={p.following ? "ghost" : "primary"}
                icon={p.following ? "check" : "plus"}
                onPress={() => requireMember(`Sign up to follow @${p.handle}.`, () => void setFollow(p.id, !p.following))}
              />
            )}
          </View>
          <View style={{ marginTop: space[5] }}>
            <Segmented items={tabs} value={activeTab} onChange={setTab} testIDPrefix="profile-tab" />
          </View>
          <View style={{ paddingTop: 3 }}>
            {grid.isPending ? (
              <PosterGridSkeleton width={width} />
            ) : grid.isError ? (
              <ErrorState what="This list" onRetry={() => void grid.refetch()} />
            ) : (grid.data ?? []).length === 0 ? (
              <TabEmpty tab={activeTab} isMe={isMe} handle={p.handle} />
            ) : (
              <PosterGrid
                games={grid.data ?? []}
                width={width}
                labelFor={activeTab === "best" ? (g) => `Best ${fmtScore((g as { best?: number }).best ?? 0, (grid.data ?? []).find((x) => x.id === g.id)?.score_config)}` : undefined}
                onPress={(g) => router.push({ pathname: "/play", params: { first: g.slug, title: activeTab === "games" ? `@${p.handle}` : g.name } })}
              />
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: "center", minWidth: 64 }} accessible accessibilityLabel={`${value} ${label}`}>
      <T variant="headline">{formatCount(value)}</T>
      <T variant="monoLabel" color="textDim">
        {label}
      </T>
    </View>
  );
}

function TabEmpty({ tab, isMe, handle }: { tab: ProfileTab; isMe: boolean; handle: string }) {
  if (tab === "saved") return <EmptyState icon="save" title="Nothing saved." body="Hit ★ on a game you'd replay at 2am." testID="empty-saved" />;
  if (tab === "liked")
    return <EmptyState icon="like" title="No likes yet." body={isMe ? "The heart is on the right of every game. Use it generously." : `@${handle} hasn't liked anything yet.`} />;
  if (tab === "best")
    return <EmptyState icon="trophy" title="No scores yet." body={isMe ? "Every legend starts with a first run. Go set one." : `@${handle} hasn't put a score on the board yet.`} action={isMe ? "Play something" : undefined} onAction={isMe ? () => router.navigate("/") : undefined} />;
  return <EmptyState icon="grid" title="No games yet." body={isMe ? "Your first game could be in this grid by Friday." : `@${handle} is cooking something. Check back soon.`} action={isMe ? "Start building" : undefined} onAction={isMe ? () => router.navigate("/create") : undefined} />;
}

function ProfileSkeleton({ width }: { width: number }) {
  return (
    <View style={{ gap: space[4] }} accessibilityLabel="Loading profile">
      <View style={{ paddingHorizontal: layout.gutter, flexDirection: "row", gap: space[4], alignItems: "center" }}>
        <Skeleton style={{ width: 96, height: 96, borderRadius: 27 }} />
        <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ width: 56, height: 34 }} />
          ))}
        </View>
      </View>
      <View style={{ paddingHorizontal: layout.gutter, gap: space[2] }}>
        <Skeleton style={{ width: 180, height: 22 }} />
        <Skeleton style={{ width: 260, height: 14 }} />
        <Skeleton style={{ height: 40, marginTop: space[2] }} />
      </View>
      <PosterGridSkeleton width={width} />
    </View>
  );
}

function openProfileMore(userId: string, handle: string, blocked: boolean) {
  openSheet({
    key: "profile-more",
    snap: 0.34,
    accessibilityLabel: `@${handle} options`,
    render: (close) => (
      <>
        <SheetDragArea>
          <SheetTitle>@{handle}</SheetTitle>
        </SheetDragArea>
        <SheetRow
          icon="flag"
          label={`Report @${handle}`}
          onPress={() => {
            close();
            setTimeout(() => requireMember("Sign up to report accounts.", () => openReportSheet("user", userId, handle)), 250);
          }}
        />
        <SheetRow
          icon="lock"
          label={blocked ? `Unblock @${handle}` : `Block @${handle}`}
          hint={blocked ? undefined : "They won't show up in your feed, comments or leaderboards"}
          danger={!blocked}
          onPress={() => {
            close();
            setTimeout(() => requireMember("Sign up to block people.", () => void (blocked ? unblockUser(userId) : blockUser(userId, handle))), 250);
          }}
        />
      </>
    ),
  });
}

export function MyProfile() {
  const myId = useAuth((s) => s.userId);
  return <MyProfileInner key={myId ?? "none"} />;
}

function MyProfileInner() {
  const me = useMe();
  const { width } = useWindowDimensions();
  if (!me.data) {
    return (
      <Screen>
        <Header title="" />
        <ProfileSkeleton width={width} />
      </Screen>
    );
  }
  return <ProfileView handle={me.data.handle} self />;
}

