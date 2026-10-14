import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 2, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

export const qk = {
  me: ["me"] as const,
  profile: (handle: string) => ["profile", handle] as const,
  profileById: (id: string) => ["profileById", id] as const,
  feed: (key: string) => ["feed", key] as const,
  game: (slug: string) => ["game", slug] as const,
  gamesByCreator: (id: string) => ["gamesByCreator", id] as const,
  comments: (gameId: string) => ["comments", gameId] as const,
  replies: (commentId: string) => ["replies", commentId] as const,
  leaderboard: (gameId: string, scope: string) => ["leaderboard", gameId, scope] as const,
  notifications: ["notifications"] as const,
  discover: ["discover"] as const,
  tag: (tag: string) => ["tag", tag] as const,
  search: (q: string) => ["search", q] as const,
  profileTab: (userId: string, tab: string) => ["profileTab", userId, tab] as const,
  blocked: ["blocked"] as const,
  creatorHub: ["creatorHub"] as const,
};
