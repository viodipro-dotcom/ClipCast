/**
 * Canonical plan IDs and UI labels. Stored in public.entitlements.plan.
 * Plan IDs: try_free, basic, pro, pro_plus, agency (do not use "starter" as active id).
 */

export const PLAN_IDS = [
  "try_free",
  "basic",
  "pro",
  "pro_plus",
  "agency",
] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PLAN_LABELS: Record<PlanId, string> = {
  try_free: "Try Free",
  basic: "Basic",
  pro: "Pro",
  pro_plus: "Pro+",
  agency: "Agency",
};

/** Display order for pricing/account UI. */
export const PLAN_SORT_ORDER: PlanId[] = [
  "try_free",
  "basic",
  "pro",
  "pro_plus",
  "agency",
];

/** Plans not yet available for checkout. */
export const PLAN_COMING_SOON: Record<PlanId, boolean> = {
  try_free: false,
  basic: false,
  pro: false,
  pro_plus: false,
  agency: true,
};

/**
 * Human-readable plan name. Use for account/pricing UI.
 * Backward compatibility: "starter" is displayed as "Basic".
 */
export function planDisplayName(planId: string): string {
  if (planId === "starter") return "Basic";
  if (planId in PLAN_LABELS) return PLAN_LABELS[planId as PlanId];
  return planId.charAt(0).toUpperCase() + planId.slice(1).toLowerCase();
}

/** Alias for planDisplayName (same behavior). */
export function formatPlanName(planId: string): string {
  return planDisplayName(planId);
}

export function isPlanComingSoon(planId: string): boolean {
  if (planId === "starter") return false;
  return planId in PLAN_COMING_SOON && PLAN_COMING_SOON[planId as PlanId];
}
