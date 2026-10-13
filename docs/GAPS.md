# Gaps

What could not be finished or verified, and exactly what a human must do.

## Credentials (needed for production, not for local development)
- Sign in with Apple / Google: implemented behind `EXPO_PUBLIC_AUTH_APPLE_ENABLED` / `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`. Buttons render only when enabled. Needs an Apple Developer account (Services ID + key) and Google OAuth client IDs configured in Supabase Auth (`supabase/config.toml` → `[auth.external.apple]`, `[auth.external.google]`). Locally, email OTP (Mailpit at :54324) and guest mode work end to end.
