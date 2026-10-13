
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "best_scores": {
                  Row: {
                    "achieved_at": string,"best_score": number,"game_id": string,"session_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achieved_at"?: string,"best_score": number,"game_id": string,"session_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "achieved_at"?: string,"best_score"?: number,"game_id"?: string,"session_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "best_scores_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "best_scores_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "play_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "best_scores_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"blocks": {
                  Row: {
                    "blocked_id": string,"blocker_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_id": string,"blocker_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_id"?: string,"blocker_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "blocks_blocked_id_fkey"
      columns: ["blocked_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blocks_blocker_id_fkey"
      columns: ["blocker_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cli_device_codes": {
                  Row: {
                    "approved_at": string | null,"created_at": string,"creator_id": string | null,"device_code_hash": string,"expires_at": string,"token_id": string | null,"token_plain_once": string | null,"user_code": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"created_at"?: string,"creator_id"?: string | null,"device_code_hash": string,"expires_at": string,"token_id"?: string | null,"token_plain_once"?: string | null,"user_code": string
                  }
                  Update: {
                    "approved_at"?: string | null,"created_at"?: string,"creator_id"?: string | null,"device_code_hash"?: string,"expires_at"?: string,"token_id"?: string | null,"token_plain_once"?: string | null,"user_code"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cli_device_codes_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cli_device_codes_token_id_fkey"
      columns: ["token_id"]
isOneToOne: false
      referencedRelation: "creator_tokens"
      referencedColumns: ["id"]
    }
                  ]
                },"comment_likes": {
                  Row: {
                    "comment_id": string,"created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "comment_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comment_likes_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comment_likes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"comments": {
                  Row: {
                    "body": string,"created_at": string,"game_id": string,"id": string,"is_pinned": boolean,"is_seed": boolean,"like_count": number,"parent_id": string | null,"reply_count": number,"score_badge": number | null,"status": Database["public"]['Enums']["comment_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"game_id": string,"id"?: string,"is_pinned"?: boolean,"is_seed"?: boolean,"like_count"?: number,"parent_id"?: string | null,"reply_count"?: number,"score_badge"?: number | null,"status"?: Database["public"]['Enums']["comment_status"],"user_id": string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"game_id"?: string,"id"?: string,"is_pinned"?: boolean,"is_seed"?: boolean,"like_count"?: number,"parent_id"?: string | null,"reply_count"?: number,"score_badge"?: number | null,"status"?: Database["public"]['Enums']["comment_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "comments_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "comments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"creator_tokens": {
                  Row: {
                    "created_at": string,"creator_id": string,"id": string,"last_used_at": string | null,"name": string,"revoked_at": string | null,"token_hash": string,"token_prefix": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"creator_id": string,"id"?: string,"last_used_at"?: string | null,"name": string,"revoked_at"?: string | null,"token_hash": string,"token_prefix": string
                  }
                  Update: {
                    "created_at"?: string,"creator_id"?: string,"id"?: string,"last_used_at"?: string | null,"name"?: string,"revoked_at"?: string | null,"token_hash"?: string,"token_prefix"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "creator_tokens_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"daily_scores": {
                  Row: {
                    "achieved_at": string,"best_score": number,"day": string,"game_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "achieved_at"?: string,"best_score": number,"day"?: string,"game_id": string,"user_id": string
                  }
                  Update: {
                    "achieved_at"?: string,"best_score"?: number,"day"?: string,"game_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_scores_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_scores_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"editorial_rows": {
                  Row: {
                    "active": boolean,"created_at": string,"game_ids": (string)[],"id": string,"position": number,"slug": string,"subtitle": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"game_ids"?: (string)[],"id"?: string,"position"?: number,"slug": string,"subtitle"?: string | null,"title": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"game_ids"?: (string)[],"id"?: string,"position"?: number,"slug"?: string,"subtitle"?: string | null,"title"?: string
                  }
                  Relationships: [
                    
                  ]
                },"feed_config": {
                  Row: {
                    "key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"feed_events": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261013": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261014": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261015": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261016": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261017": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261018": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261019": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_20261020": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"feed_events_default": {
                  Row: {
                    "card_id": string | null,"client_ts": string | null,"created_at": string,"duration_ms": number | null,"dwell_ms": number | null,"feed_id": string | null,"game_id": string | null,"id": number,"meta": Json | null,"score": number | null,"state": string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type": Database["public"]['Enums']["feed_event_type"],"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "card_id"?: string | null,"client_ts"?: string | null,"created_at"?: string,"duration_ms"?: number | null,"dwell_ms"?: number | null,"feed_id"?: string | null,"game_id"?: string | null,"id"?: never,"meta"?: Json | null,"score"?: number | null,"state"?: string | null,"type"?: Database["public"]['Enums']["feed_event_type"],"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"follows": {
                  Row: {
                    "created_at": string,"followee_id": string,"follower_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"followee_id": string,"follower_id": string
                  }
                  Update: {
                    "created_at"?: string,"followee_id"?: string,"follower_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follows_followee_id_fkey"
      columns: ["followee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follows_follower_id_fkey"
      columns: ["follower_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"game_hashtags": {
                  Row: {
                    "game_id": string,"position": number,"tag": string
                  }
                  ComputedFields: never
                  Insert: {
                    "game_id": string,"position"?: number,"tag": string
                  }
                  Update: {
                    "game_id"?: string,"position"?: number,"tag"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "game_hashtags_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "game_hashtags_tag_fkey"
      columns: ["tag"]
isOneToOne: false
      referencedRelation: "hashtags"
      referencedColumns: ["tag"]
    }
                  ]
                },"game_kv": {
                  Row: {
                    "game_id": string,"key": string,"updated_at": string,"user_id": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "game_id": string,"key": string,"updated_at"?: string,"user_id": string,"value": NonNullable<Json>
                  }
                  Update: {
                    "game_id"?: string,"key"?: string,"updated_at"?: string,"user_id"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "game_kv_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "game_kv_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"game_stats_daily": {
                  Row: {
                    "comments": number,"day": string,"fast_skips": number,"game_id": string,"impressions": number,"likes": number,"load_failures": number,"play_ends": number,"play_starts": number,"ready_count": number,"replays": number,"saves": number,"shares": number,"total_play_ms": number,"unique_players": number
                  }
                  ComputedFields: never
                  Insert: {
                    "comments"?: number,"day": string,"fast_skips"?: number,"game_id": string,"impressions"?: number,"likes"?: number,"load_failures"?: number,"play_ends"?: number,"play_starts"?: number,"ready_count"?: number,"replays"?: number,"saves"?: number,"shares"?: number,"total_play_ms"?: number,"unique_players"?: number
                  }
                  Update: {
                    "comments"?: number,"day"?: string,"fast_skips"?: number,"game_id"?: string,"impressions"?: number,"likes"?: number,"load_failures"?: number,"play_ends"?: number,"play_starts"?: number,"ready_count"?: number,"replays"?: number,"saves"?: number,"shares"?: number,"total_play_ms"?: number,"unique_players"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "game_stats_daily_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    }
                  ]
                },"game_versions": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"bundle_path": string,"created_at": string,"game_id": string,"gzip_bytes": number,"id": string,"manifest": NonNullable<Json>,"release_notes": string | null,"review_notes": string | null,"review_report": Json | null,"semver": string,"size_bytes": number,"status": Database["public"]['Enums']["version_status"],"submitted_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"bundle_path": string,"created_at"?: string,"game_id": string,"gzip_bytes"?: number,"id"?: string,"manifest": NonNullable<Json>,"release_notes"?: string | null,"review_notes"?: string | null,"review_report"?: Json | null,"semver": string,"size_bytes"?: number,"status"?: Database["public"]['Enums']["version_status"],"submitted_by"?: string | null
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"bundle_path"?: string,"created_at"?: string,"game_id"?: string,"gzip_bytes"?: number,"id"?: string,"manifest"?: NonNullable<Json>,"release_notes"?: string | null,"review_notes"?: string | null,"review_report"?: Json | null,"semver"?: string,"size_bytes"?: number,"status"?: Database["public"]['Enums']["version_status"],"submitted_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "game_versions_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "game_versions_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "game_versions_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"games": {
                  Row: {
                    "accent_color": string,"age_rating": Database["public"]['Enums']["age_rating"],"audio": boolean,"comment_count": number,"controls": NonNullable<Json>,"created_at": string,"creator_id": string,"description": string,"featured_rank": number | null,"icon_url": string | null,"id": string,"is_seed": boolean,"like_count": number,"live_version_id": string | null,"name": string,"play_count": number,"poster_url": string | null,"primary_tag": string | null,"published_at": string | null,"save_count": number,"score_config": NonNullable<Json>,"session_length": string,"share_count": number,"slug": string,"status": Database["public"]['Enums']["game_status"],"tags": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accent_color"?: string,"age_rating"?: Database["public"]['Enums']["age_rating"],"audio"?: boolean,"comment_count"?: number,"controls"?: NonNullable<Json>,"created_at"?: string,"creator_id": string,"description"?: string,"featured_rank"?: number | null,"icon_url"?: string | null,"id"?: string,"is_seed"?: boolean,"like_count"?: number,"live_version_id"?: string | null,"name": string,"play_count"?: number,"poster_url"?: string | null,"primary_tag"?: never,"published_at"?: string | null,"save_count"?: number,"score_config"?: NonNullable<Json>,"session_length"?: string,"share_count"?: number,"slug": string,"status"?: Database["public"]['Enums']["game_status"],"tags"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "accent_color"?: string,"age_rating"?: Database["public"]['Enums']["age_rating"],"audio"?: boolean,"comment_count"?: number,"controls"?: NonNullable<Json>,"created_at"?: string,"creator_id"?: string,"description"?: string,"featured_rank"?: number | null,"icon_url"?: string | null,"id"?: string,"is_seed"?: boolean,"like_count"?: number,"live_version_id"?: string | null,"name"?: string,"play_count"?: number,"poster_url"?: string | null,"primary_tag"?: never,"published_at"?: string | null,"save_count"?: number,"score_config"?: NonNullable<Json>,"session_length"?: string,"share_count"?: number,"slug"?: string,"status"?: Database["public"]['Enums']["game_status"],"tags"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "games_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "games_live_version_fk"
      columns: ["live_version_id"]
isOneToOne: false
      referencedRelation: "game_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"hashtags": {
                  Row: {
                    "created_at": string,"game_count": number,"tag": string,"trend_score": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"game_count"?: number,"tag": string,"trend_score"?: number
                  }
                  Update: {
                    "created_at"?: string,"game_count"?: number,"tag"?: string,"trend_score"?: number
                  }
                  Relationships: [
                    
                  ]
                },"likes": {
                  Row: {
                    "created_at": string,"game_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"game_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"game_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "likes_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "likes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_words": {
                  Row: {
                    "created_at": string,"kind": string,"word": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"kind"?: string,"word": string
                  }
                  Update: {
                    "created_at"?: string,"kind"?: string,"word"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notifications": {
                  Row: {
                    "actor_id": string | null,"comment_id": string | null,"created_at": string,"game_id": string | null,"id": string,"payload": NonNullable<Json>,"pushed_at": string | null,"read_at": string | null,"type": Database["public"]['Enums']["notification_type"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"comment_id"?: string | null,"created_at"?: string,"game_id"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"pushed_at"?: string | null,"read_at"?: string | null,"type": Database["public"]['Enums']["notification_type"],"user_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"comment_id"?: string | null,"created_at"?: string,"game_id"?: string | null,"id"?: string,"payload"?: NonNullable<Json>,"pushed_at"?: string | null,"read_at"?: string | null,"type"?: Database["public"]['Enums']["notification_type"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"play_sessions": {
                  Row: {
                    "accepted": boolean | null,"duration_ms": number | null,"ended_at": string | null,"game_id": string,"id": string,"launch_reason": string,"outcome": string | null,"reject_reason": string | null,"score": number | null,"started_at": string,"user_id": string,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted"?: boolean | null,"duration_ms"?: number | null,"ended_at"?: string | null,"game_id": string,"id"?: string,"launch_reason"?: string,"outcome"?: string | null,"reject_reason"?: string | null,"score"?: number | null,"started_at"?: string,"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "accepted"?: boolean | null,"duration_ms"?: number | null,"ended_at"?: string | null,"game_id"?: string,"id"?: string,"launch_reason"?: string,"outcome"?: string | null,"reject_reason"?: string | null,"score"?: number | null,"started_at"?: string,"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "play_sessions_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "play_sessions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "play_sessions_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "game_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "age_band": Database["public"]['Enums']["age_band"] | null,"avatar_seed": string,"avatar_url": string | null,"bio": string,"created_at": string,"display_name": string,"dock_coach_shown": number,"follower_count": number,"following_count": number,"game_count": number,"handle": string,"id": string,"interests": (string)[],"is_guest": boolean,"is_seed": boolean,"likes_received": number,"role": Database["public"]['Enums']["user_role"],"updated_at": string,"verified": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "age_band"?: Database["public"]['Enums']["age_band"] | null,"avatar_seed": string,"avatar_url"?: string | null,"bio"?: string,"created_at"?: string,"display_name": string,"dock_coach_shown"?: number,"follower_count"?: number,"following_count"?: number,"game_count"?: number,"handle": string,"id": string,"interests"?: (string)[],"is_guest"?: boolean,"is_seed"?: boolean,"likes_received"?: number,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string,"verified"?: boolean
                  }
                  Update: {
                    "age_band"?: Database["public"]['Enums']["age_band"] | null,"avatar_seed"?: string,"avatar_url"?: string | null,"bio"?: string,"created_at"?: string,"display_name"?: string,"dock_coach_shown"?: number,"follower_count"?: number,"following_count"?: number,"game_count"?: number,"handle"?: string,"id"?: string,"interests"?: (string)[],"is_guest"?: boolean,"is_seed"?: boolean,"likes_received"?: number,"role"?: Database["public"]['Enums']["user_role"],"updated_at"?: string,"verified"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"push_tokens": {
                  Row: {
                    "created_at": string,"platform": string,"token": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"platform": string,"token": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"platform"?: string,"token"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_tokens_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"details": string | null,"id": string,"reason": string,"reporter_id": string,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": Database["public"]['Enums']["report_status"],"target_id": string,"target_type": Database["public"]['Enums']["report_target"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"details"?: string | null,"id"?: string,"reason": string,"reporter_id": string,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"target_id": string,"target_type": Database["public"]['Enums']["report_target"]
                  }
                  Update: {
                    "created_at"?: string,"details"?: string | null,"id"?: string,"reason"?: string,"reporter_id"?: string,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"target_id"?: string,"target_type"?: Database["public"]['Enums']["report_target"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"review_jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"error": string | null,"finished_at": string | null,"id": string,"locked_at": string | null,"locked_by": string | null,"status": Database["public"]['Enums']["review_job_status"],"version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"locked_at"?: string | null,"locked_by"?: string | null,"status"?: Database["public"]['Enums']["review_job_status"],"version_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"locked_at"?: string | null,"locked_by"?: string | null,"status"?: Database["public"]['Enums']["review_job_status"],"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_jobs_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "game_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"saves": {
                  Row: {
                    "created_at": string,"game_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"game_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"game_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saves_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saves_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"shares": {
                  Row: {
                    "challenge_score": number | null,"channel": string,"code": string,"created_at": string,"game_id": string,"id": string,"open_count": number,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "challenge_score"?: number | null,"channel"?: string,"code": string,"created_at"?: string,"game_id": string,"id"?: string,"open_count"?: number,"user_id"?: string | null
                  }
                  Update: {
                    "challenge_score"?: number | null,"channel"?: string,"code"?: string,"created_at"?: string,"game_id"?: string,"id"?: string,"open_count"?: number,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "shares_game_id_fkey"
      columns: ["game_id"]
isOneToOne: false
      referencedRelation: "games"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shares_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_tag_affinity": {
                  Row: {
                    "tag": string,"updated_at": string,"user_id": string,"weight": number
                  }
                  ComputedFields: never
                  Insert: {
                    "tag": string,"updated_at"?: string,"user_id": string,"weight"?: number
                  }
                  Update: {
                    "tag"?: string,"updated_at"?: string,"user_id"?: string,"weight"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_tag_affinity_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "allowed_age_ratings":
{ Args: { "p_band": Database["public"]['Enums']["age_band"] }; Returns: (Database["public"]['Enums']["age_rating"])[]
                           },
"approve_version":
{ Args: { "p_notes"?: string,"p_version_id": string }; Returns: undefined
                           },
"become_creator":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"beta_sample":
{ Args: { "a": number,"b": number }; Returns: number
                           },
"claim_guest_scores":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"cleanup_stale_sessions":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"compute_trending":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"create_creator_token":
{ Args: { "token_name": string }; Returns: {
              "id": string,"token": string,"token_prefix": string
            }[]
                           },
"decay_affinity":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"dispatch_push":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"ensure_feed_event_partitions":
{ Args: { "days_ahead"?: number }; Returns: undefined
                           },
"enter_trusted":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"feed_hydrate":
{ Args: { "p_game_ids": (string)[],"p_viewer": string }; Returns: {
              "accent_color": string,"age_rating": string,"allowed": boolean,"audio": boolean,"comment_count": number,"controls": Json,"creator_avatar_seed": string,"creator_avatar_url": string,"creator_display_name": string,"creator_handle": string,"creator_id": string,"creator_verified": boolean,"description": string,"entry": string,"following": boolean,"game_id": string,"icon_url": string,"like_count": number,"liked": boolean,"name": string,"play_count": number,"poster_url": string,"save_count": number,"saved": boolean,"score_config": Json,"sdk": string,"semver": string,"session_length": string,"share_count": number,"slug": string,"tags": (string)[],"top_score": number,"version_id": string,"viewer_best": number
            }[]
                           },
"finish_play_session":
{ Args: { "p_duration_ms": number,"p_outcome"?: string,"p_score": number,"p_session": string,"p_user": string }; Returns: {
              "accepted": boolean,"best": number,"daily_rank": number,"is_new_best": boolean,"percentile": number,"reason": string
            }[]
                           },
"game_top_score":
{ Args: { "p_game": string }; Returns: number
                           },
"in_trusted_path":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"ingest_events":
{ Args: { "p_events": Json,"p_user": string }; Returns: number
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_blocked_between":
{ Args: { "a": string,"b": string }; Returns: boolean
                           },
"is_creator":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_service":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"leaderboard":
{ Args: { "p_game_id": string,"p_limit"?: number,"p_scope"?: string }; Returns: {
              "avatar_seed": string,"avatar_url": string,"display_name": string,"handle": string,"is_me": boolean,"rank": number,"score": number,"user_id": string
            }[]
                           },
"leaderboard_me":
{ Args: { "p_game_id": string }; Returns: {
              "best": number,"percentile": number,"rank": number
            }[]
                           },
"rank_feed":
{ Args: { "p_cursor"?: Json,"p_limit"?: number,"p_tab"?: string,"p_tag"?: string,"p_viewer": string }; Returns: {
              "game_id": string,"score": number,"source": string
            }[]
                           },
"reject_version":
{ Args: { "p_notes": string,"p_version_id": string }; Returns: undefined
                           },
"resolve_share":
{ Args: { "p_code": string }; Returns: {
              "code": string,"from_guest": boolean,"from_handle": string,"from_name": string,"game_id": string,"game_slug": string,"score": number
            }[]
                           },
"rollback_to_version":
{ Args: { "p_version_id": string }; Returns: undefined
                           },
"rollup_game_stats":
{ Args: { "p_days"?: number }; Returns: undefined
                           },
"score_better":
{ Args: { "a": number,"b": number,"p_order": string }; Returns: boolean
                           },
"set_runtime_secret":
{ Args: { "p_name": string,"p_value": string }; Returns: undefined
                           },
"start_play_session":
{ Args: { "p_game": string,"p_reason"?: string,"p_user": string,"p_version": string }; Returns: string
                           },
"takedown_game":
{ Args: { "p_game_id": string,"p_reason": string }; Returns: undefined
                           },
"today_percentile":
{ Args: { "p_exclude": string,"p_game": string,"p_score": number }; Returns: number
                           },
"viewer_best":
{ Args: { "p_game": string,"p_viewer": string }; Returns: number
                           }
          }
          Enums: {
            "age_band": "under13"|"13to15"|"16to17"|"adult","age_rating": "4+"|"9+"|"12+"|"17+","comment_status": "visible"|"hidden"|"removed","feed_event_type": "impression"|"ready"|"play_start"|"play_end"|"skip"|"replay"|"like"|"unlike"|"save"|"unsave"|"share"|"comment"|"follow"|"open_game_page"|"load_failed"|"custom","game_status": "draft"|"in_review"|"live"|"rejected"|"removed","notification_type": "follow"|"comment_like"|"comment_reply"|"score_beaten"|"new_game"|"game_approved"|"game_rejected"|"challenge_accepted","report_status": "open"|"actioned"|"dismissed","report_target": "game"|"comment"|"user","review_job_status": "queued"|"running"|"done"|"failed","user_role": "user"|"creator"|"admin","version_status": "uploaded"|"auto_checking"|"auto_failed"|"pending_review"|"approved"|"rejected"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "age_band": ["under13", "13to15", "16to17", "adult"],"age_rating": ["4+", "9+", "12+", "17+"],"comment_status": ["visible", "hidden", "removed"],"feed_event_type": ["impression", "ready", "play_start", "play_end", "skip", "replay", "like", "unlike", "save", "unsave", "share", "comment", "follow", "open_game_page", "load_failed", "custom"],"game_status": ["draft", "in_review", "live", "rejected", "removed"],"notification_type": ["follow", "comment_like", "comment_reply", "score_beaten", "new_game", "game_approved", "game_rejected", "challenge_accepted"],"report_status": ["open", "actioned", "dismissed"],"report_target": ["game", "comment", "user"],"review_job_status": ["queued", "running", "done", "failed"],"user_role": ["user", "creator", "admin"],"version_status": ["uploaded", "auto_checking", "auto_failed", "pending_review", "approved", "rejected"]
          }
        }
} as const
