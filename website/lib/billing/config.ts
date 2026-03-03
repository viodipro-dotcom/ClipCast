/**
 * Billing config: env vars and plan → Stripe mapping.
 * Safe when Stripe env vars are missing (no crash).
 */

import type { PlanId } from "@/lib/plans";

const PURCHASABLE_PLANS: PlanId[] = ["basic", "pro", "pro_plus"];
const COMING_SOON_PLANS: PlanId[] = ["agency"];

function getEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}

/** Stripe secret key (server-only). Never expose to client. */
export function getStripeSecretKey(): string | undefined {
  return getEnv("STRIPE_SECRET_KEY");
}

/** Stripe webhook signing secret for verifying webhook payloads. */
export function getStripeWebhookSecret(): string | undefined {
  return getEnv("STRIPE_WEBHOOK_SECRET");
}

/** Publishable key for client-side Stripe.js (optional). */
export function getStripePublishableKey(): string | undefined {
  return getEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
}

/** Base URL for success/cancel redirects. */
export function getSiteUrl(): string | undefined {
  return getEnv("NEXT_PUBLIC_SITE_URL");
}

/** Plan id → Stripe Price ID (recurring subscription). */
export function getStripePriceId(planId: string): string | undefined {
  switch (planId) {
    case "basic":
      return getEnv("STRIPE_PRICE_ID_BASIC");
    case "pro":
      return getEnv("STRIPE_PRICE_ID_PRO");
    case "pro_plus":
      return getEnv("STRIPE_PRICE_ID_PRO_PLUS");
    default:
      return undefined;
  }
}

/** Stripe Price ID → internal plan key (for webhook). Returns undefined if unknown or agency not yet active. */
export function getPlanKeyFromStripePriceId(priceId: string): "basic" | "pro" | "pro_plus" | undefined {
  const basic = getEnv("STRIPE_PRICE_ID_BASIC");
  const pro = getEnv("STRIPE_PRICE_ID_PRO");
  const proPlus = getEnv("STRIPE_PRICE_ID_PRO_PLUS");
  if (priceId === basic) return "basic";
  if (priceId === pro) return "pro";
  if (priceId === proPlus) return "pro_plus";
  return undefined;
}

/** Whether Stripe is configured enough to create checkout/portal sessions. */
export function isStripeConfigured(): boolean {
  return !!getStripeSecretKey();
}

/** Alias for isStripeConfigured – use when checking if billing is ready. */
export function isBillingConfigured(): boolean {
  return isStripeConfigured();
}

/** Plans that can be purchased via checkout (basic, pro, pro_plus). */
export function isPurchasablePlan(planId: string): planId is PlanId {
  return PURCHASABLE_PLANS.includes(planId as PlanId);
}

/** Plans that are not yet available (e.g. agency). */
export function isComingSoonPlan(planId: string): boolean {
  return COMING_SOON_PLANS.includes(planId as PlanId);
}
