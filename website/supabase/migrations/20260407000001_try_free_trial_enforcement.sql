-- Ensure Try Free trial has start/end dates and enforce expiry in quota RPCs.

-- -----------------------------------------------------------------------------
-- 1) New users: set trial dates on entitlement creation
-- -----------------------------------------------------------------------------
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
  INSERT INTO public.entitlements (
    user_id,
    plan,
    status,
    trial_started_at,
    trial_ends_at,
    trial_used,
    updated_at
  )
  VALUES (
    NEW.id,
    'try_free',
    'active',
    now(),
    now() + interval '7 days',
    true,
    now()
  );
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) Backfill missing trial dates for existing try_free users
-- -----------------------------------------------------------------------------
WITH target AS (
  SELECT
    user_id,
    COALESCE(trial_started_at, updated_at, now()) AS start_at
  FROM public.entitlements
  WHERE plan = 'try_free'
    AND status = 'active'
    AND trial_ends_at IS NULL
)
UPDATE public.entitlements e
SET
  trial_started_at = t.start_at,
  trial_ends_at = t.start_at + interval '7 days',
  trial_used = true,
  updated_at = now()
FROM target t
WHERE e.user_id = t.user_id;

-- Mark expired Try Free trials inactive.
UPDATE public.entitlements
SET status = 'inactive',
    updated_at = now()
WHERE plan = 'try_free'
  AND status = 'active'
  AND trial_ends_at IS NOT NULL
  AND trial_ends_at < now();

-- -----------------------------------------------------------------------------
-- 3) Enforce trial expiry in usage RPCs
-- -----------------------------------------------------------------------------
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
  v_trial_ends_at timestamptz;
  v_uploads_limit integer;
  v_metadata_limit integer;
  v_usage public.usage_monthly%rowtype;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT plan, status, trial_ends_at
  INTO v_ent_plan, v_ent_status, v_trial_ends_at
  FROM public.entitlements
  WHERE user_id = v_user_id;

  IF (v_ent_plan = 'try_free' OR v_ent_plan = 'free')
     AND v_trial_ends_at IS NOT NULL
     AND v_trial_ends_at < now() THEN
    UPDATE public.entitlements
    SET status = 'inactive',
        updated_at = now()
    WHERE user_id = v_user_id;
    v_ent_status := 'inactive';
  END IF;

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
  v_trial_ends_at timestamptz;
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

  SELECT plan, status, trial_ends_at
  INTO v_ent_plan, v_ent_status, v_trial_ends_at
  FROM public.entitlements
  WHERE user_id = v_user_id;

  IF (v_ent_plan = 'try_free' OR v_ent_plan = 'free')
     AND v_trial_ends_at IS NOT NULL
     AND v_trial_ends_at < now() THEN
    UPDATE public.entitlements
    SET status = 'inactive',
        updated_at = now()
    WHERE user_id = v_user_id;
    v_ent_status := 'inactive';
  END IF;

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

CREATE OR REPLACE FUNCTION public.reserve_quota(kind text, request_id uuid, amount integer DEFAULT 1)
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
  v_trial_ends_at timestamptz;
  v_uploads_limit integer;
  v_metadata_limit integer;
  v_usage public.usage_monthly%rowtype;
  v_existing public.usage_reservations%rowtype;
  v_pending_uploads integer := 0;
  v_pending_metadata integer := 0;
  v_limit integer;
  v_remaining integer;
  v_new_total integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request_id';
  END IF;

  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  IF kind NOT IN ('upload', 'metadata') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;

  -- Auto-release stale pending reservations (safety cleanup).
  UPDATE public.usage_reservations
  SET status = 'released',
      updated_at = now(),
      released_at = now()
  WHERE user_id = v_user_id
    AND status = 'pending'
    AND created_at < now() - interval '60 minutes';

  SELECT plan, status, trial_ends_at
  INTO v_ent_plan, v_ent_status, v_trial_ends_at
  FROM public.entitlements
  WHERE user_id = v_user_id;

  IF (v_ent_plan = 'try_free' OR v_ent_plan = 'free')
     AND v_trial_ends_at IS NOT NULL
     AND v_trial_ends_at < now() THEN
    UPDATE public.entitlements
    SET status = 'inactive',
        updated_at = now()
    WHERE user_id = v_user_id;
    v_ent_status := 'inactive';
  END IF;

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
  INTO v_existing
  FROM public.usage_reservations ur
  WHERE ur.user_id = v_user_id AND ur.request_id = reserve_quota.request_id;

  IF FOUND THEN
    SELECT *
    INTO v_usage
    FROM public.usage_monthly
    WHERE user_id = v_user_id AND period_start = v_period_start;

    SELECT COALESCE(SUM(ur.amount), 0)
    INTO v_pending_uploads
    FROM public.usage_reservations ur
    WHERE ur.user_id = v_user_id
      AND period_start = v_period_start
      AND status = 'pending'
      AND ur.kind = 'upload';

    SELECT COALESCE(SUM(ur.amount), 0)
    INTO v_pending_metadata
    FROM public.usage_reservations ur
    WHERE ur.user_id = v_user_id
      AND period_start = v_period_start
      AND status = 'pending'
      AND ur.kind = 'metadata';

    IF kind = 'upload' THEN
      v_limit := v_uploads_limit;
      v_new_total := COALESCE(v_usage.uploads_used, 0) + v_pending_uploads;
    ELSE
      v_limit := v_metadata_limit;
      v_new_total := COALESCE(v_usage.metadata_used, 0) + v_pending_metadata;
    END IF;

    v_remaining := CASE
      WHEN v_limit IS NULL THEN NULL
      ELSE GREATEST(v_limit - v_new_total, 0)
    END;

    RETURN jsonb_build_object(
      'reservation_id', v_existing.id,
      'status', v_existing.status,
      'remaining', v_remaining
    );
  END IF;

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

  SELECT COALESCE(SUM(ur.amount), 0)
  INTO v_pending_uploads
  FROM public.usage_reservations ur
  WHERE ur.user_id = v_user_id
    AND period_start = v_period_start
    AND status = 'pending'
    AND ur.kind = 'upload';

  SELECT COALESCE(SUM(ur.amount), 0)
  INTO v_pending_metadata
  FROM public.usage_reservations ur
  WHERE ur.user_id = v_user_id
    AND period_start = v_period_start
    AND status = 'pending'
    AND ur.kind = 'metadata';

  IF kind = 'upload' THEN
    v_limit := v_uploads_limit;
    v_new_total := v_usage.uploads_used + v_pending_uploads + amount;
  ELSE
    v_limit := v_metadata_limit;
    v_new_total := v_usage.metadata_used + v_pending_metadata + amount;
  END IF;

  IF v_limit IS NOT NULL AND v_new_total > v_limit THEN
    RAISE EXCEPTION 'limit_exceeded';
  END IF;

  INSERT INTO public.usage_reservations (
    user_id,
    request_id,
    period_start,
    kind,
    amount,
    status
  )
  VALUES (
    v_user_id,
    request_id,
    v_period_start,
    kind,
    amount,
    'pending'
  )
  RETURNING * INTO v_existing;

  RETURN jsonb_build_object(
    'reservation_id', v_existing.id,
    'status', v_existing.status,
    'remaining', CASE
      WHEN v_limit IS NULL THEN NULL
      ELSE GREATEST(v_limit - v_new_total, 0)
    END
  );
END;
$$;
