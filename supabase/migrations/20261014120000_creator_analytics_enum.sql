-- Creator analytics (docs/prompts/creator-dashboard.md): the inbox/push type for milestones.
-- In its own migration because a new enum value can't be used in the transaction that adds it.
alter type public.notification_type add value if not exists 'milestone';
