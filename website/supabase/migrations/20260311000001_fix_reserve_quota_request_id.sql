-- Fix ambiguous request_id reference in reserve_quota.

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

  v_remaining := CASE
    WHEN v_limit IS NULL THEN NULL
    ELSE GREATEST(v_limit - v_new_total, 0)
  END;

  RETURN jsonb_build_object(
    'reservation_id', v_existing.id,
    'status', v_existing.status,
    'remaining', v_remaining
  );
END;
$$;
