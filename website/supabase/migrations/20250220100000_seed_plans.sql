-- Replace "free" with "starter" as the default/base plan.
-- Canonical plan IDs: starter, pro, agency (see website README / lib/plans).

-- 1. Update trigger: new users get plan = 'starter' (was 'free')
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
  VALUES (NEW.id, 'starter', 'inactive');
  RETURN NEW;
END;
$$;

-- 2. Table default for plan (so any direct insert gets 'starter')
ALTER TABLE public.entitlements
  ALTER COLUMN plan SET DEFAULT 'starter';

-- 3. Backfill existing entitlements: free → starter
UPDATE public.entitlements
SET plan = 'starter', updated_at = now()
WHERE plan = 'free';
