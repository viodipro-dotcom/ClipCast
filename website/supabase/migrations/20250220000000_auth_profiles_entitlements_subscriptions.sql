-- Auth, profiles, entitlements, and subscriptions foundation
-- Run this in Supabase SQL Editor (or via Supabase CLI) for the project used by the Next.js website.

-- =============================================================================
-- 1. Tables
-- =============================================================================

-- Profiles: one row per auth user (synced from auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Entitlements: plan and status per user (free/paid, active/inactive)
CREATE TABLE IF NOT EXISTS public.entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'inactive',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Subscriptions: Stripe subscription data (skeleton for billing)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id text,
  status text,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. RLS: enable and policies (users can read/update only their own rows)
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Profiles: select and update own row
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Entitlements: select and update own row
CREATE POLICY "Users can read own entitlement"
  ON public.entitlements FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own entitlement"
  ON public.entitlements FOR UPDATE
  USING (auth.uid() = user_id);

-- Subscriptions: select and update own rows
CREATE POLICY "Users can read own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role / backend can insert (e.g. trigger, webhooks). For trigger we use SECURITY DEFINER.
-- No INSERT policy for authenticated users on profiles/entitlements (created by trigger).
-- Stripe webhook will insert/update subscriptions with service role.

-- =============================================================================
-- 3. Trigger: auto-create profile + entitlement on new auth user
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
  VALUES (NEW.id, 'free', 'inactive');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 4. Optional: backfill existing auth.users that predate the trigger
-- =============================================================================

INSERT INTO public.profiles (id, email, full_name, avatar_url)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'), raw_user_meta_data->>'avatar_url'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.entitlements (user_id, plan, status)
SELECT id, 'free', 'inactive'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
