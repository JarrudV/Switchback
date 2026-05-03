DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS adjusted_by_coach boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS adjusted_by_coach_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_coach_adjustment_event_id varchar(64);

    CREATE INDEX IF NOT EXISTS sessions_adjusted_by_coach_idx
      ON sessions (user_id, adjusted_by_coach);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS coach_adjustment_proposals (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id text NOT NULL DEFAULT '__legacy__',
  active_week integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  changes jsonb NOT NULL,
  source_user_message text NOT NULL,
  coach_reply text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'coach_adjustment_proposals'::regclass
      AND conname = 'coach_adjustment_proposals_status_check'
  ) THEN
    ALTER TABLE coach_adjustment_proposals
      ADD CONSTRAINT coach_adjustment_proposals_status_check
      CHECK (status IN ('pending', 'applied', 'cancelled', 'expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS coach_adjustment_proposals_user_id_created_idx
  ON coach_adjustment_proposals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_adjustment_proposals_user_id_status_idx
  ON coach_adjustment_proposals (user_id, status);

CREATE TABLE IF NOT EXISTS coach_adjustment_events (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id text NOT NULL DEFAULT '__legacy__',
  proposal_id varchar(64) NOT NULL,
  active_week integer NOT NULL,
  applied_count integer NOT NULL,
  skipped_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_adjustment_events_user_id_created_idx
  ON coach_adjustment_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_adjustment_events_user_id_proposal_idx
  ON coach_adjustment_events (user_id, proposal_id);

CREATE TABLE IF NOT EXISTS coach_adjustment_event_items (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id text NOT NULL DEFAULT '__legacy__',
  event_id varchar(64) NOT NULL,
  session_id varchar(64) NOT NULL,
  status text NOT NULL,
  skip_reason text,
  before_minutes integer,
  after_minutes integer,
  before_zone text,
  after_zone text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'coach_adjustment_event_items'::regclass
      AND conname = 'coach_adjustment_event_items_status_check'
  ) THEN
    ALTER TABLE coach_adjustment_event_items
      ADD CONSTRAINT coach_adjustment_event_items_status_check
      CHECK (status IN ('applied', 'skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS coach_adjustment_event_items_user_id_event_idx
  ON coach_adjustment_event_items (user_id, event_id);
CREATE INDEX IF NOT EXISTS coach_adjustment_event_items_user_id_session_idx
  ON coach_adjustment_event_items (user_id, session_id);
