import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

export const ENTITLEMENTS_TABLE = 'entitlements';
export const SUBSCRIPTIONS_TABLE = 'subscriptions';

/** Offline grace period: allow premium using cached entitlement for up to this long without a successful refresh. */
export const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/** localStorage key for last successful entitlement check timestamp (signed-in user). */
export const ENTITLEMENT_LAST_CHECK_AT_KEY = 'clipcast_entitlement_last_check_at';

type EntitlementRow = {
  plan?: string | null;
  status?: string | null;
  trial_ends_at?: string | null;
  trial_used?: boolean | null;
};

type SubscriptionRow = {
  id?: string;
  customer_id?: string | null;
  status?: string | null;
  current_period_end?: string | number | null;
  cancel_at_period_end?: boolean | null;
  ended_at?: string | number | null;
};

export type AuthEntitlementState = 'loading' | 'signedOut' | 'signedIn';

export interface AuthEntitlementSnapshot {
  authState: AuthEntitlementState;
  user: User | null;
  isSignedIn: boolean;
  isActive: boolean;
  planName: string;
  status: string;
  currentPeriodEnd: string | number | null;
  renewsOn: string | null;
  entitlement: EntitlementRow | null;
  subscription: SubscriptionRow | null;
}

export const INITIAL_AUTH_ENTITLEMENT: AuthEntitlementSnapshot = {
  authState: 'loading',
  user: null,
  isSignedIn: false,
  isActive: false,
  planName: 'try_free',
  status: 'inactive',
  currentPeriodEnd: null,
  renewsOn: null,
  entitlement: null,
  subscription: null,
};

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'trial']);

function normalizeDateValue(value: string | number | null | undefined): string | number | null {
  if (value == null) return null;
  if (typeof value !== 'number') return value;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function formatRenewalDate(value: string | number | null | undefined): string | null {
  const normalized = normalizeDateValue(value);
  if (normalized == null) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(parsed);
}

function isActiveStatus(status: string | null | undefined): boolean {
  return ACTIVE_STATUSES.has(String(status || '').trim().toLowerCase());
}

function mapSignedOut(session: Session | null): AuthEntitlementSnapshot {
  return {
    ...INITIAL_AUTH_ENTITLEMENT,
    authState: 'signedOut',
    user: session?.user ?? null,
  };
}

export async function loadAuthAndEntitlement(
  supabase: SupabaseClient | null,
): Promise<AuthEntitlementSnapshot> {
  if (!supabase) return mapSignedOut(null);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return mapSignedOut(session);

  const user = session.user;

  const [entitlementRes, subscriptionRes] = await Promise.all([
    supabase
      .from(ENTITLEMENTS_TABLE)
      .select('plan, status, trial_ends_at, trial_used')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from(SUBSCRIPTIONS_TABLE)
      .select('id, customer_id, status, current_period_end, cancel_at_period_end, ended_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (entitlementRes.error) throw entitlementRes.error;
  if (subscriptionRes.error) throw subscriptionRes.error;

  const entitlement = entitlementRes.data ?? null;
  const subscription = subscriptionRes.data ?? null;

  const planName = entitlement?.plan ?? 'try_free';
  const status = entitlement?.status ?? subscription?.status ?? 'inactive';
  const currentPeriodEnd = subscription?.current_period_end ?? subscription?.ended_at ?? null;

  return {
    authState: 'signedIn',
    user,
    isSignedIn: true,
    isActive: isActiveStatus(status),
    planName,
    status,
    currentPeriodEnd,
    renewsOn: formatRenewalDate(currentPeriodEnd),
    entitlement: {
      plan: planName,
      status,
      trial_ends_at: entitlement?.trial_ends_at ?? null,
      trial_used: entitlement?.trial_used ?? null,
    },
    subscription,
  };
}
