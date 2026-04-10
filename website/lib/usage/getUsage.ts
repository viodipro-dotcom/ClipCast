import { createClient } from "@/lib/supabase/server";
import type { EntitlementRow, SubscriptionRow } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type UsageSummary = {
  configured: boolean;
  uploadsUsed?: number;
  uploadsLimit?: number | null;
  metadataUsed?: number;
  metadataLimit?: number | null;
  uploadsRemaining?: number | null;
  metadataRemaining?: number | null;
  periodEnd?: string | null;
  plan?: string;
  status?: string;
};

type LimitMap = Record<
  string,
  {
    uploadsLimit: number | null;
    metadataLimit: number | null;
  }
>;

type PostgrestErrorLike = { code?: string; message?: string };

const FALLBACK_LIMITS: LimitMap = {
  try_free: { uploadsLimit: 20, metadataLimit: 30 },
  basic: { uploadsLimit: 50, metadataLimit: 150 },
  pro: { uploadsLimit: 200, metadataLimit: 400 },
  pro_plus: { uploadsLimit: 500, metadataLimit: 1000 },
  agency: { uploadsLimit: null, metadataLimit: null },
};

function normalizePlanId(planId?: string | null): string {
  if (!planId) return "try_free";
  if (planId === "starter") return "basic";
  if (planId === "free") return "try_free";
  return planId;
}

export type AccountStatusSummary = {
  plan: string;
  status: string;
  periodEnd: string | null;
};

export function mapAccountStatus(
  entitlement?: EntitlementRow | null,
  subscription?: SubscriptionRow | null
): AccountStatusSummary {
  const plan = entitlement?.plan ?? "try_free";
  const status = entitlement?.status ?? subscription?.status ?? "inactive";
  const periodEnd = subscription?.current_period_end ?? subscription?.ended_at ?? null;
  return { plan, status, periodEnd };
}

function isMissingRelation(error: PostgrestErrorLike | null, relation: string): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = error.message?.toLowerCase() ?? "";
  return (
    (message.includes("does not exist") && message.includes(relation)) ||
    (message.includes("schema cache") && message.includes(relation))
  );
}

function getPeriodStartIso(): string {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return periodStart.toISOString().slice(0, 10);
}

async function resolvePlanLimits(
  supabase: SupabaseClient,
  planId: string
): Promise<{ uploadsLimit: number | null; metadataLimit: number | null }> {
  const { data, error } = await supabase
    .from("plans")
    .select("uploads_limit, metadata_generations_limit")
    .eq("id", planId)
    .maybeSingle();

  if (!data || error) {
    // TODO: Confirm plan limits source of truth once plans table is guaranteed.
    return FALLBACK_LIMITS[planId] ?? FALLBACK_LIMITS.try_free;
  }

  return {
    uploadsLimit: data.uploads_limit ?? null,
    metadataLimit: data.metadata_generations_limit ?? null,
  };
}

function normalizeLimit(value?: number | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function computeRemaining(used: number, limit?: number | null): number | null {
  if (limit == null) return null;
  return Math.max(limit - used, 0);
}

async function resolveUsageSnapshotRpc(
  supabase: SupabaseClient
): Promise<{
  uploadsUsed: number;
  metadataUsed: number;
  uploadsLimit: number | null;
  metadataLimit: number | null;
} | null> {
  const { data, error } = await supabase.rpc("get_usage_snapshot");
  if (error || !data) {
    if (error) {
      console.warn("[usage] get_usage_snapshot failed:", error.message || error);
    }
    return null;
  }
  const snapshot = data as {
    uploads_used?: number;
    metadata_used?: number;
    uploads_limit?: number | null;
    metadata_limit?: number | null;
  };
  const uploadsUsed = Number(snapshot.uploads_used ?? 0);
  const metadataUsed = Number(snapshot.metadata_used ?? 0);
  return {
    uploadsUsed: Number.isFinite(uploadsUsed) ? uploadsUsed : 0,
    metadataUsed: Number.isFinite(metadataUsed) ? metadataUsed : 0,
    uploadsLimit: normalizeLimit(snapshot.uploads_limit ?? null),
    metadataLimit: normalizeLimit(snapshot.metadata_limit ?? null),
  };
}

async function resolveUsageCounters(
  supabase: SupabaseClient,
  userId: string
): Promise<
  | {
      configured: true;
      uploadsUsed: number;
      metadataUsed: number;
      periodEnd?: string | null;
    }
  | { configured: false }
> {
  const { data, error } = await supabase
    .from("usage_counters")
    .select("uploads_used, metadata_used, period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { configured: false };
  }

  return {
    configured: true,
    uploadsUsed: data?.uploads_used ?? 0,
    metadataUsed: data?.metadata_used ?? 0,
    periodEnd: data?.period_end ?? null,
  };
}

async function resolveUsageMonthly(
  supabase: SupabaseClient,
  userId: string
): Promise<
  | { configured: true; uploadsUsed: number; metadataUsed: number }
  | { configured: false }
> {
  const periodStart = getPeriodStartIso();
  const { data, error } = await supabase
    .from("usage_monthly")
    .select("uploads_used, metadata_used")
    .eq("user_id", userId)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error, "usage_monthly")) {
      return { configured: false };
    }
    return { configured: false };
  }

  return {
    configured: true,
    uploadsUsed: data?.uploads_used ?? 0,
    metadataUsed: data?.metadata_used ?? 0,
  };
}

export async function getUsage(): Promise<UsageSummary> {
  const supabase = await createClient();
  if (!supabase) return { configured: false };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { configured: false };

  const [entitlementResult, subscriptionResult] = await Promise.all([
    supabase
      .from("entitlements")
      .select("plan, status")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("subscriptions")
      .select("status, current_period_end, ended_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const account = mapAccountStatus(
    entitlementResult.data as EntitlementRow | null,
    subscriptionResult.data as SubscriptionRow | null
  );
  const planId = normalizePlanId(account.plan);

  const rpcSnapshot = await resolveUsageSnapshotRpc(supabase);
  if (rpcSnapshot) {
    return {
      configured: true,
      uploadsUsed: rpcSnapshot.uploadsUsed,
      uploadsLimit: rpcSnapshot.uploadsLimit,
      metadataUsed: rpcSnapshot.metadataUsed,
      metadataLimit: rpcSnapshot.metadataLimit,
      uploadsRemaining: computeRemaining(rpcSnapshot.uploadsUsed, rpcSnapshot.uploadsLimit),
      metadataRemaining: computeRemaining(rpcSnapshot.metadataUsed, rpcSnapshot.metadataLimit),
      periodEnd: account.periodEnd ?? null,
      plan: planId,
      status: account.status,
    };
  }

  const [limits, monthlyUsage] = await Promise.all([
    resolvePlanLimits(supabase, planId),
    resolveUsageMonthly(supabase, user.id),
  ]);

  if (!monthlyUsage.configured) {
    const countersUsage = await resolveUsageCounters(supabase, user.id);
    if (!countersUsage.configured) {
      return { configured: false, plan: planId, periodEnd: account.periodEnd ?? null, status: account.status };
    }
    return {
      configured: true,
      uploadsUsed: countersUsage.uploadsUsed,
      uploadsLimit: limits.uploadsLimit,
      metadataUsed: countersUsage.metadataUsed,
      metadataLimit: limits.metadataLimit,
      uploadsRemaining: computeRemaining(countersUsage.uploadsUsed, limits.uploadsLimit),
      metadataRemaining: computeRemaining(countersUsage.metadataUsed, limits.metadataLimit),
      periodEnd: countersUsage.periodEnd ?? account.periodEnd ?? null,
      plan: planId,
      status: account.status,
    };
  }

  return {
    configured: true,
    uploadsUsed: monthlyUsage.uploadsUsed,
    uploadsLimit: limits.uploadsLimit,
    metadataUsed: monthlyUsage.metadataUsed,
    metadataLimit: limits.metadataLimit,
    uploadsRemaining: computeRemaining(monthlyUsage.uploadsUsed, limits.uploadsLimit),
    metadataRemaining: computeRemaining(monthlyUsage.metadataUsed, limits.metadataLimit),
    periodEnd: account.periodEnd ?? null,
    plan: planId,
    status: account.status,
  };
}
