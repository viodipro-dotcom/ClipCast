/**
 * Server-only: Supabase client with service role key.
 * Use ONLY in server context (API routes, webhooks) for operations that bypass RLS
 * (e.g. Stripe webhook updating subscriptions and entitlements).
 * Never expose this client or the service role key to the browser.
 */

import { createClient } from "@supabase/supabase-js";

function getServiceRoleKey(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function getSupabaseUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Creates a Supabase client with service role key. Bypasses RLS.
 * Returns null if env vars are missing.
 */
export function createAdminClient() {
  const url = getSupabaseUrl();
  const key = getServiceRoleKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
