-- Add per-user ownership columns and key/index updates for multi-user isolation.
-- Existing rows are tagged as __legacy__ and claimed by the first authenticated user
-- via server-side storage migration logic.

DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id text;
    UPDATE sessions SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE sessions ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'sessions'::regclass AND conname = 'sessions_pkey'
    ) THEN
      ALTER TABLE sessions DROP CONSTRAINT sessions_pkey;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'sessions'::regclass AND conname = 'sessions_pkey'
    ) THEN
      ALTER TABLE sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (user_id, id);
    END IF;

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.metrics') IS NOT NULL THEN
    ALTER TABLE metrics ADD COLUMN IF NOT EXISTS user_id text;
    UPDATE metrics SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE metrics ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE metrics ALTER COLUMN user_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS metrics_user_id_idx ON metrics (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.service_items') IS NOT NULL THEN
    ALTER TABLE service_items ADD COLUMN IF NOT EXISTS user_id text;
    UPDATE service_items SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE service_items ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE service_items ALTER COLUMN user_id SET NOT NULL;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'service_items'::regclass AND conname = 'service_items_pkey'
    ) THEN
      ALTER TABLE service_items DROP CONSTRAINT service_items_pkey;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'service_items'::regclass AND conname = 'service_items_pkey'
    ) THEN
      ALTER TABLE service_items ADD CONSTRAINT service_items_pkey PRIMARY KEY (user_id, id);
    END IF;

    CREATE INDEX IF NOT EXISTS service_items_user_id_idx ON service_items (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.goal_events') IS NOT NULL THEN
    ALTER TABLE goal_events ADD COLUMN IF NOT EXISTS user_id text;
    UPDATE goal_events SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE goal_events ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE goal_events ALTER COLUMN user_id SET NOT NULL;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'goal_events'::regclass AND conname = 'goal_events_pkey'
    ) THEN
      ALTER TABLE goal_events DROP CONSTRAINT goal_events_pkey;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'goal_events'::regclass AND conname = 'goal_events_pkey'
    ) THEN
      ALTER TABLE goal_events ADD CONSTRAINT goal_events_pkey PRIMARY KEY (user_id, id);
    END IF;

    CREATE INDEX IF NOT EXISTS goal_events_user_id_idx ON goal_events (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.strava_activities') IS NOT NULL THEN
    ALTER TABLE strava_activities ADD COLUMN IF NOT EXISTS user_id text;
    UPDATE strava_activities SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE strava_activities ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE strava_activities ALTER COLUMN user_id SET NOT NULL;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'strava_activities'::regclass AND conname = 'strava_activities_pkey'
    ) THEN
      ALTER TABLE strava_activities DROP CONSTRAINT strava_activities_pkey;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'strava_activities'::regclass AND conname = 'strava_activities_pkey'
    ) THEN
      ALTER TABLE strava_activities ADD CONSTRAINT strava_activities_pkey PRIMARY KEY (user_id, id);
    END IF;

    CREATE INDEX IF NOT EXISTS strava_activities_user_id_idx ON strava_activities (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS user_id text;
    UPDATE app_settings SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE app_settings ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE app_settings ALTER COLUMN user_id SET NOT NULL;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'app_settings'::regclass AND conname = 'app_settings_pkey'
    ) THEN
      ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'app_settings'::regclass AND conname = 'app_settings_pkey'
    ) THEN
      ALTER TABLE app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (user_id, key);
    END IF;

    CREATE INDEX IF NOT EXISTS app_settings_user_id_idx ON app_settings (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.conversations') IS NOT NULL THEN
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id text;
    UPDATE conversations SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE conversations ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE conversations ALTER COLUMN user_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations (user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id text;

    IF to_regclass('public.conversations') IS NOT NULL THEN
      UPDATE messages m
      SET user_id = c.user_id
      FROM conversations c
      WHERE m.conversation_id = c.id AND m.user_id IS NULL;
    END IF;

    UPDATE messages SET user_id = '__legacy__' WHERE user_id IS NULL;
    ALTER TABLE messages ALTER COLUMN user_id SET DEFAULT '__legacy__';
    ALTER TABLE messages ALTER COLUMN user_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages (user_id);
  END IF;
END $$;
