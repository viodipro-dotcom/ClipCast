/**
 * Server-only: helpers for syncing Stripe subscription state to Supabase.
 * Used by the Stripe webhook handler. Requires Supabase admin client (service role).
 */

import { createAdminClient } from "@/lib/supabase/admin";

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

export type StripeSubscriptionLike = {
  id: string;
  customer: string;
  status: string;
  items?: { data?: Array<{ price?: { id: string } }> };
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  ended_at?: number | null;
};

/**
 * Converts Stripe epoch seconds to Postgres timestamptz (ISO string).
 * Stripe timestamps are integers; null/undefined become NULL.
 */
function stripeEpochToIso(value: number | undefined | null): string | null {
  if (value == null) return null;
  if (typeof value !== "number") return null;
  return new Date(value * 1000).toISOString();
}

/**
 * Upsert subscriptions table from a Stripe subscription object.
 * Idempotent: safe to call multiple times for the same subscription.
 *
 * Always persists: current_period_end, cancel_at_period_end, cancel_at, canceled_at,
 * ended_at, status, price_id, customer_id, user_id. Never omit these on created/updated.
 */
export async function upsertSubscriptionFromStripeEvent(
  subscription: StripeSubscriptionLike,
  userId: string
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("[subscription-sync] Supabase admin client not configured");
    return { error: "SUPABASE_NOT_CONFIGURED" };
  }

  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;

  const row = {
    id: subscription.id,
    user_id: userId,
    customer_id: subscription.customer,
    status: subscription.status,
    price_id: priceId,
    current_period_end: stripeEpochToIso(subscription.current_period_end),
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    cancel_at: stripeEpochToIso(subscription.cancel_at),
    canceled_at: stripeEpochToIso(subscription.canceled_at),
    ended_at: stripeEpochToIso(subscription.ended_at),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("subscriptions")
    .upsert(row, { onConflict: "id" });

  if (error) {
    console.error("[subscription-sync] subscriptions upsert error:", error.message);
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Update entitlements.plan and status for a user (e.g. after successful payment or cancellation).
 * Idempotent: upsert by user_id.
 */
export async function updateEntitlementsFromPlan(
  userId: string,
  planId: string,
  status: "active" | "inactive" | "canceled"
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  if (!admin) {
    console.error("[subscription-sync] Supabase admin client not configured");
    return { error: "SUPABASE_NOT_CONFIGURED" };
  }

  const { error } = await admin.from("entitlements").upsert(
    {
      user_id: userId,
      plan: planId,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("[subscription-sync] entitlements upsert error:", error.message);
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Get user_id for a Stripe customer_id from existing subscriptions row.
 * Used when handling subscription.updated/deleted without session context.
 */
export async function getUserIdByCustomerId(
  customerId: string
): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("customer_id", customerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.user_id ?? null;
}
