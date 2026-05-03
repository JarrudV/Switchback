DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS age integer;
  END IF;
END $$;
