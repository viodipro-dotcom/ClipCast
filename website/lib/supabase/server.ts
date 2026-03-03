import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

export type EntitlementRow = {
  user_id: string;
  plan: string;
  status: string;
  updated_at: string;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_used?: boolean | null;
};

export type SubscriptionRow = {
  id: string;
  user_id: string;
  customer_id: string | null;
  status: string | null;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  updated_at: string;
};

export async function createClient(): Promise<SupabaseClient | null> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Ignore in Server Component context (e.g. during static render)
        }
      },
    },
  });
}

/** Server-only: returns the current user or null. Safe when env vars are missing. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Server-only: returns the current user's entitlement row, or null (fallback to try_free/inactive in UI). */
export async function getCurrentUserEntitlement(): Promise<EntitlementRow | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("entitlements")
    .select("user_id, plan, status, updated_at")
    .eq("user_id", user.id)
    .single();
  if (!data) return null;
  const { data: trial } = await supabase
    .from("entitlements")
    .select("trial_started_at, trial_ends_at, trial_used")
    .eq("user_id", user.id)
    .single();
  if (trial) return { ...data, ...trial };
  return data;
}

/** Server-only: returns the user's subscription row if any (for portal / renewal date). */
export async function getCurrentUserSubscription(): Promise<SubscriptionRow | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("id, user_id, customer_id, status, price_id, current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
