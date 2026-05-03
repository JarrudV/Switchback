DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sessions'
        AND column_name = 'completed_at'
        AND data_type IN ('text', 'character varying')
    ) THEN
      ALTER TABLE sessions
      ALTER COLUMN completed_at TYPE timestamptz
      USING CASE
        WHEN completed_at IS NULL OR completed_at = '' THEN NULL
        ELSE completed_at::timestamptz
      END;
    END IF;

    ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS completion_source text;

    UPDATE sessions
      SET completion_source = 'manual'
      WHERE completed = true
        AND completion_source IS NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'sessions'::regclass
        AND conname = 'sessions_completion_source_check'
    ) THEN
      ALTER TABLE sessions
        ADD CONSTRAINT sessions_completion_source_check
        CHECK (completion_source IS NULL OR completion_source IN ('manual', 'strava'));
    END IF;
  END IF;
END $$;
