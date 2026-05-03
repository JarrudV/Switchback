DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS completed_strava_activity_id varchar(64),
      ADD COLUMN IF NOT EXISTS completion_match_score real;

    CREATE INDEX IF NOT EXISTS sessions_completed_strava_activity_idx
      ON sessions (user_id, completed_strava_activity_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS strava_session_links (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id text NOT NULL DEFAULT '__legacy__',
  session_id varchar(64) NOT NULL,
  strava_activity_id varchar(64) NOT NULL,
  date_delta_days integer NOT NULL,
  duration_delta_pct real NOT NULL,
  confidence text NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'strava_session_links'::regclass
      AND conname = 'strava_session_links_confidence_check'
  ) THEN
    ALTER TABLE strava_session_links
      ADD CONSTRAINT strava_session_links_confidence_check
      CHECK (confidence IN ('high', 'medium'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS strava_session_links_user_session_unique_idx
  ON strava_session_links (user_id, session_id);
CREATE UNIQUE INDEX IF NOT EXISTS strava_session_links_user_activity_unique_idx
  ON strava_session_links (user_id, strava_activity_id);
CREATE INDEX IF NOT EXISTS strava_session_links_user_matched_idx
  ON strava_session_links (user_id, matched_at);

CREATE TABLE IF NOT EXISTS ride_insights (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id text NOT NULL DEFAULT '__legacy__',
  strava_activity_id varchar(64) NOT NULL,
  session_id varchar(64),
  proposal_id varchar(64),
  headline text NOT NULL,
  summary text NOT NULL,
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ride_insights_user_created_idx
  ON ride_insights (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ride_insights_user_activity_idx
  ON ride_insights (user_id, strava_activity_id);

CREATE TABLE IF NOT EXISTS plan_realign_events (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id text NOT NULL DEFAULT '__legacy__',
  from_date text NOT NULL,
  to_date text NOT NULL,
  delta_days integer NOT NULL,
  affected_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_realign_events_user_created_idx
  ON plan_realign_events (user_id, created_at DESC);
