-- Add Stripe subscription lifecycle timestamps for cancel/end dates.
-- Ensures we persist current_period_end, cancel_at, canceled_at, ended_at from webhooks
-- so the Account page can show "Ends on" / "Renewal date" from synced data.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

COMMENT ON COLUMN public.subscriptions.cancel_at IS 'Stripe: when subscription will end (e.g. when cancel_at_period_end is true)';
COMMENT ON COLUMN public.subscriptions.canceled_at IS 'Stripe: when subscription was marked to cancel';
COMMENT ON COLUMN public.subscriptions.ended_at IS 'Stripe: when subscription actually ended';
