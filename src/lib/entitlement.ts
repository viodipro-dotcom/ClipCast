/**
 * Open-source app: no cloud account, subscription, or entitlement checks.
 * Kept for compatibility with existing UI types (planAccess, authEntitlementRef).
 */

export const ENTITLEMENTS_TABLE = 'entitlements';
export const SUBSCRIPTIONS_TABLE = 'subscriptions';

/** Legacy constant; no longer used for gating. */
export const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export const ENTITLEMENT_LAST_CHECK_AT_KEY = 'clipcast_entitlement_last_check_at';

export type EntitlementRow = {
  plan?: string | null;
  status?: string | null;
  trial_ends_at?: string | null;
  trial_used?: boolean | null;
};

export type SubscriptionRow = {
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
  user: null;
  isSignedIn: boolean;
  isActive: boolean;
  planName: string;
  status: string;
  currentPeriodEnd: string | number | null;
  renewsOn: string | null;
  entitlement: EntitlementRow | null;
  subscription: SubscriptionRow | null;
}

/** Full app access: no sign-in, no paywall. */
export const OPEN_ACCESS: AuthEntitlementSnapshot = {
  authState: 'signedIn',
  user: null,
  isSignedIn: true,
  isActive: true,
  planName: 'open',
  status: 'active',
  currentPeriodEnd: null,
  renewsOn: null,
  entitlement: { plan: 'open', status: 'active' },
  subscription: null,
};

export const INITIAL_AUTH_ENTITLEMENT: AuthEntitlementSnapshot = OPEN_ACCESS;

export async function loadAuthAndEntitlement(): Promise<AuthEntitlementSnapshot> {
  return OPEN_ACCESS;
}
