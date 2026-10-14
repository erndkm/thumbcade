/** Row shapes the app reads directly through PostgREST (RLS-scoped). */

export type AgeBand = "under13" | "13to15" | "16to17" | "adult";
export type Role = "user" | "creator" | "admin";

export interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string;
  bio: string;
  age_band: AgeBand | null;
  role: Role;
  verified: boolean;
  is_guest: boolean;
  follower_count: number;
  following_count: number;
  game_count: number;
  likes_received: number;
  interests: string[];
  dock_coach_shown: number;
  created_at: string;
}

export interface GameRow {
  id: string;
  slug: string;
  creator_id: string;
  name: string;
  description: string;
  icon_url: string | null;
  poster_url: string | null;
  accent_color: string;
  tags: string[];
  primary_tag: string | null;
  age_rating: string;
  controls: { vertical: boolean; horizontal?: boolean; multitouch?: boolean; inputs?: string[] };
  session_length: "short" | "medium" | "long";
  score_config: { order?: "asc" | "desc"; max: number; format?: "integer" | "ms"; unit?: string };
  status: string;
  live_version_id: string | null;
  play_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
  published_at: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  game_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  like_count: number;
  reply_count: number;
  score_badge: number | null;
  is_pinned: boolean;
  status: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: "follow" | "comment_like" | "comment_reply" | "score_beaten" | "new_game" | "game_approved" | "game_rejected" | "challenge_accepted";
  actor_id: string | null;
  game_id: string | null;
  comment_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface LeaderboardRow {
  rank: number;
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string;
  score: number;
  is_me: boolean;
}

export const PROFILE_PUBLIC =
  "id, handle, display_name, avatar_url, avatar_seed, bio, role, verified, is_guest, follower_count, following_count, game_count, likes_received, created_at";
export const GAME_CARD_COLUMNS =
  "id, slug, creator_id, name, description, icon_url, poster_url, accent_color, tags, primary_tag, age_rating, controls, session_length, score_config, status, live_version_id, play_count, like_count, comment_count, share_count, save_count, published_at, created_at";
