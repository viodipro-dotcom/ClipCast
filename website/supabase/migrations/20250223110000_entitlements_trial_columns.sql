-- Optional: trial tracking on entitlements for activate-trial and UI.
-- Safe idempotent migration (add columns if not present).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entitlements' AND column_name = 'trial_started_at'
  ) THEN
    ALTER TABLE public.entitlements ADD COLUMN trial_started_at timestamptz NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entitlements' AND column_name = 'trial_ends_at'
  ) THEN
    ALTER TABLE public.entitlements ADD COLUMN trial_ends_at timestamptz NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entitlements' AND column_name = 'trial_used'
  ) THEN
    ALTER TABLE public.entitlements ADD COLUMN trial_used boolean NOT NULL DEFAULT false;
  END IF;
END
$$;
