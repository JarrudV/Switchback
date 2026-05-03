DO $$
BEGIN
  IF to_regclass('public.metrics') IS NOT NULL THEN
    -- Normalize existing metric dates to YYYY-MM-DD when possible.
    UPDATE metrics
    SET date = substring(date from 1 for 10)
    WHERE date IS NOT NULL
      AND date ~ '^\d{4}-\d{2}-\d{2}';

    -- Deduplicate to one row per (user_id, date), keeping the lowest id.
    DELETE FROM metrics m
    USING metrics d
    WHERE m.user_id = d.user_id
      AND m.date = d.date
      AND m.id > d.id;

    CREATE UNIQUE INDEX IF NOT EXISTS metrics_user_id_date_unique_idx
      ON metrics (user_id, date);
  END IF;
END $$;
