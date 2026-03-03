-- Plans catalog + entitlements update for new plan structure.
-- Plan IDs: try_free, basic, pro, pro_plus, agency (do not use "starter" as active plan id).
-- New users get try_free with status active (trial). Existing rows unchanged except default.

-- =============================================================================
-- 1. Plans table (catalog for UI/limits; entitlements.plan stores plan id)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  price_monthly_usd numeric,
  uploads_limit integer,
  metadata_generations_limit integer,
  youtube_accounts_limit integer,
  is_trial boolean NOT NULL DEFAULT false,
  trial_days integer,
  is_active boolean NOT NULL DEFAULT true,
  coming_soon boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: plans are read-only for authenticated users
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plans"
  ON public.plans FOR SELECT
  USING (true);

-- =============================================================================
-- 2. Seed plans (idempotent UPSERT)
-- =============================================================================

INSERT INTO public.plans (
  id,
  display_name,
  price_monthly_usd,
  uploads_limit,
  metadata_generations_limit,
  youtube_accounts_limit,
  is_trial,
  trial_days,
  is_active,
  coming_soon,
  sort_order
) VALUES
  ('try_free', 'Try Free', 0, 5, 15, 1, true, 1, true, false, 1),
  ('basic', 'Basic', 15, 50, 150, 1, false, null, true, false, 2),
  ('pro', 'Pro', 25, 200, 400, 1, false, null, true, false, 3),
  ('pro_plus', 'Pro+', 49, 500, 1000, 1, false, null, true, false, 4),
  ('agency', 'Agency', null, null, null, null, false, null, true, true, 5)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  price_monthly_usd = EXCLUDED.price_monthly_usd,
  uploads_limit = EXCLUDED.uploads_limit,
  metadata_generations_limit = EXCLUDED.metadata_generations_limit,
  youtube_accounts_limit = EXCLUDED.youtube_accounts_limit,
  is_trial = EXCLUDED.is_trial,
  trial_days = EXCLUDED.trial_days,
  is_active = EXCLUDED.is_active,
  coming_soon = EXCLUDED.coming_soon,
  sort_order = EXCLUDED.sort_order;

-- =============================================================================
-- 3. New user default: try_free, status active (trial)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  INSERT INTO public.entitlements (user_id, plan, status)
  VALUES (NEW.id, 'try_free', 'active');
  RETURN NEW;
END;
$$;

-- Table default for new inserts (e.g. backfills)
ALTER TABLE public.entitlements
  ALTER COLUMN plan SET DEFAULT 'try_free';

-- Optional: do not change existing entitlement rows; leave starter/free as-is for backward compat.
-- UI will display "starter" as "Basic". No backfill here to avoid touching existing users.
