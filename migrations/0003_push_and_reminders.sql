DO $$
BEGIN
  IF to_regclass('public.service_items') IS NOT NULL THEN
    ALTER TABLE service_items
      ADD COLUMN IF NOT EXISTS due_date text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id text NOT NULL DEFAULT '__legacy__',
  endpoint text NOT NULL,
  subscription jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id text NOT NULL DEFAULT '__legacy__',
  timezone text NOT NULL DEFAULT 'UTC',
  long_ride_evening_before_enabled boolean NOT NULL DEFAULT false,
  service_due_date_enabled boolean NOT NULL DEFAULT false,
  goal_one_week_countdown_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);
CREATE INDEX IF NOT EXISTS reminder_settings_user_id_idx ON reminder_settings (user_id);

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id text NOT NULL DEFAULT '__legacy__',
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS in_app_notifications_user_id_idx ON in_app_notifications (user_id);

CREATE TABLE IF NOT EXISTS notification_dispatches (
  user_id text NOT NULL DEFAULT '__legacy__',
  dedupe_key text NOT NULL,
  channel text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS notification_dispatches_user_id_idx ON notification_dispatches (user_id);
