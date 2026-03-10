import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Supabase client for the Electron renderer (OAuth in external browser + deep link).
 * - persistSession: true, autoRefreshToken: true
 * - detectSessionInUrl: false (callback is clipcast:// deep link, not a web URL)
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;

/** @deprecated Use `supabase`; kept for backward compatibility. */
export function getSupabase(): SupabaseClient | null {
  return supabase;
}
