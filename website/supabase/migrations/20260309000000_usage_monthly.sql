-- Monthly usage tracking + quota enforcement RPCs.

-- =============================================================================
-- 1. usage_monthly table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.usage_monthly (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  uploads_used integer NOT NULL DEFAULT 0,
  metadata_used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start)
);

ALTER TABLE public.usage_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage"
  ON public.usage_monthly
  FOR SELECT
  USING (auth.uid() = user_id);

-- No insert/update policies for authenticated users; use RPCs only.

-- =============================================================================
-- 2. Helper: usage snapshot
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_usage_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_period_start date := date_trunc('month', (now() at time zone 'utc'))::date;
  v_ent_plan text;
  v_plan_id text;
  v_ent_status text;
  v_sub_status text;
  v_status text;
  v_uploads_limit integer;
  v_metadata_limit integer;
  v_usage public.usage_monthly%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT plan, status
  INTO v_ent_plan, v_ent_status
  FROM public.entitlements
  WHERE user_id = v_user_id;

  SELECT status
  INTO v_sub_status
  FROM public.subscriptions
  WHERE user_id = v_user_id
  ORDER BY updated_at DESC
  LIMIT 1;

  v_status := COALESCE(v_ent_status, v_sub_status, 'inactive');
  IF lower(v_status) NOT IN ('active', 'trialing', 'trial') THEN
    RAISE EXCEPTION 'not_subscribed';
  END IF;

  v_plan_id := COALESCE(v_ent_plan, 'try_free');
  IF v_plan_id = 'starter' THEN
    v_plan_id := 'basic';
  ELSIF v_plan_id = 'free' THEN
    v_plan_id := 'try_free';
  END IF;

  SELECT uploads_limit, metadata_generations_limit
  INTO v_uploads_limit, v_metadata_limit
  FROM public.plans
  WHERE id = v_plan_id;

  SELECT *
  INTO v_usage
  FROM public.usage_monthly
  WHERE user_id = v_user_id AND period_start = v_period_start;

  RETURN jsonb_build_object(
    'period_start', v_period_start,
    'uploads_used', COALESCE(v_usage.uploads_used, 0),
    'metadata_used', COALESCE(v_usage.metadata_used, 0),
    'uploads_limit', v_uploads_limit,
    'metadata_limit', v_metadata_limit
  );
END;
$$;

-- =============================================================================
-- 3. Quota consumption RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.consume_quota(kind text, amount integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_period_start date := date_trunc('month', (now() at time zone 'utc'))::date;
  v_ent_plan text;
  v_plan_id text;
  v_ent_status text;
  v_sub_status text;
  v_status text;
  v_uploads_limit integer;
  v_metadata_limit integer;
  v_usage public.usage_monthly%rowtype;
  v_new_uploads integer;
  v_new_metadata integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT plan, status
  INTO v_ent_plan, v_ent_status
  FROM public.entitlements
  WHERE user_id = v_user_id;

  SELECT status
  INTO v_sub_status
  FROM public.subscriptions
  WHERE user_id = v_user_id
  ORDER BY updated_at DESC
  LIMIT 1;

  v_status := COALESCE(v_ent_status, v_sub_status, 'inactive');
  IF lower(v_status) NOT IN ('active', 'trialing', 'trial') THEN
    RAISE EXCEPTION 'not_subscribed';
  END IF;

  v_plan_id := COALESCE(v_ent_plan, 'try_free');
  IF v_plan_id = 'starter' THEN
    v_plan_id := 'basic';
  ELSIF v_plan_id = 'free' THEN
    v_plan_id := 'try_free';
  END IF;

  SELECT uploads_limit, metadata_generations_limit
  INTO v_uploads_limit, v_metadata_limit
  FROM public.plans
  WHERE id = v_plan_id;

  SELECT *
  INTO v_usage
  FROM public.usage_monthly
  WHERE user_id = v_user_id AND period_start = v_period_start
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.usage_monthly (user_id, period_start, uploads_used, metadata_used)
    VALUES (v_user_id, v_period_start, 0, 0)
    RETURNING * INTO v_usage;
  END IF;

  IF kind = 'upload' THEN
    v_new_uploads := v_usage.uploads_used + amount;
    IF v_uploads_limit IS NOT NULL AND v_new_uploads > v_uploads_limit THEN
      RAISE EXCEPTION 'limit_exceeded';
    END IF;
    UPDATE public.usage_monthly
    SET uploads_used = v_new_uploads,
        updated_at = now()
    WHERE user_id = v_user_id AND period_start = v_period_start
    RETURNING * INTO v_usage;
  ELSIF kind = 'metadata' THEN
    v_new_metadata := v_usage.metadata_used + amount;
    IF v_metadata_limit IS NOT NULL AND v_new_metadata > v_metadata_limit THEN
      RAISE EXCEPTION 'limit_exceeded';
    END IF;
    UPDATE public.usage_monthly
    SET metadata_used = v_new_metadata,
        updated_at = now()
    WHERE user_id = v_user_id AND period_start = v_period_start
    RETURNING * INTO v_usage;
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  RETURN jsonb_build_object(
    'period_start', v_period_start,
    'uploads_used', COALESCE(v_usage.uploads_used, 0),
    'metadata_used', COALESCE(v_usage.metadata_used, 0),
    'uploads_limit', v_uploads_limit,
    'metadata_limit', v_metadata_limit
  );
END;
$$;
