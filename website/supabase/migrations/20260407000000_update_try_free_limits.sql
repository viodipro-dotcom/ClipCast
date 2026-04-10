-- Update Try Free trial duration and limits.
UPDATE public.plans
SET
  uploads_limit = 20,
  metadata_generations_limit = 30,
  trial_days = 7,
  is_trial = true
WHERE id = 'try_free';
