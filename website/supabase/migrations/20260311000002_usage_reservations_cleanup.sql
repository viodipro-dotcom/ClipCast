-- Cleanup helper and optional scheduled job for stale reservations.

CREATE OR REPLACE FUNCTION public.release_stale_usage_reservations(
  max_age interval DEFAULT '60 minutes',
  delete_after interval DEFAULT '7 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released integer := 0;
  v_deleted integer := 0;
BEGIN
  UPDATE public.usage_reservations
  SET status = 'released',
      updated_at = now(),
      released_at = now()
  WHERE status = 'pending'
    AND created_at < now() - max_age;

  GET DIAGNOSTICS v_released = ROW_COUNT;

  DELETE FROM public.usage_reservations
  WHERE status = 'released'
    AND COALESCE(released_at, updated_at, created_at) < now() - delete_after;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_released + v_deleted;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'release_stale_usage_reservations'
    ) THEN
      PERFORM cron.schedule(
        'release_stale_usage_reservations',
        '*/10 * * * *',
        $job$select public.release_stale_usage_reservations('60 minutes', '7 days');$job$
      );
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available: %', SQLERRM;
END;
$$;
