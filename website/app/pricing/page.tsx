import Link from "next/link";
import {
  getCurrentUser,
  getCurrentUserEntitlement,
  getCurrentUserSubscription,
} from "@/lib/supabase/server";
import { PLAN_LABELS, PLAN_SORT_ORDER, isPlanComingSoon } from "@/lib/plans";
import { PricingPlanActions } from "./PricingPlanActions";
import styles from "./page.module.css";

const PLAN_FEATURES: Record<
  keyof typeof PLAN_LABELS,
  { price: string; period?: string; lines: string[]; cta: string; ctaHref?: string; disabled?: boolean }
> = {
  try_free: {
    price: "1 day trial",
    period: undefined,
    lines: [
      "5 uploads",
      "15 metadata generations",
      "YouTube: connect & upload",
      "Unlimited YouTube channels (switch anytime)",
    ],
    cta: "Try Free",
    ctaHref: "/account",
  },
  basic: {
    price: "$15",
    period: "/ month",
    lines: [
      "50 uploads / month",
      "150 metadata generations / month",
      "YouTube: connect & upload",
      "Unlimited YouTube channels (switch anytime)",
    ],
    cta: "Choose Basic",
    ctaHref: "/account",
  },
  pro: {
    price: "$25",
    period: "/ month",
    lines: [
      "200 uploads / month",
      "400 metadata generations / month",
      "YouTube: connect & upload",
      "Unlimited YouTube channels (switch anytime)",
    ],
    cta: "Choose Pro",
    ctaHref: "/account",
  },
  pro_plus: {
    price: "$49",
    period: "/ month",
    lines: [
      "500 uploads / month",
      "1000 metadata generations / month",
      "YouTube: connect & upload",
      "Unlimited YouTube channels (switch anytime)",
    ],
    cta: "Choose Pro+",
    ctaHref: "/account",
  },
  agency: {
    price: "Coming soon",
    period: undefined,
    lines: [
      "Multi-account",
      "Team seats",
      "Higher limits",
    ],
    cta: "Coming soon",
    disabled: true,
  },
};

export default async function PricingPage() {
  const [user, entitlement, subscription] = await Promise.all([
    getCurrentUser(),
    getCurrentUserEntitlement(),
    getCurrentUserSubscription(),
  ]);
  const isSignedIn = !!user;
  const hasBillingAccount = !!subscription?.customer_id;
  const hasActiveTrialOrPlan =
    !!entitlement &&
    entitlement.status === "active" &&
    (entitlement.plan === "try_free" ||
      entitlement.plan === "basic" ||
      entitlement.plan === "pro" ||
      entitlement.plan === "pro_plus");
  const hasActiveSubscription = entitlement?.status === "active";
  const currentPlanId = hasActiveSubscription ? entitlement?.plan ?? null : null;

  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <h1>Simple pricing</h1>
        <p className={styles.subtitle}>
          Start with a 1-day free trial, then choose the plan that fits. Agency for teams is coming soon.
        </p>
        <div className={styles.heroActions}>
          <Link href="/download" className={styles.ctaSecondary}>
            Download app
          </Link>
        </div>
      </section>

      <section className={styles.plans}>
        {PLAN_SORT_ORDER.map((planId) => {
          const comingSoon = isPlanComingSoon(planId);
          const features = PLAN_FEATURES[planId];
          const isDisabled = features.disabled ?? comingSoon;
          const isCurrentPlan =
            hasActiveSubscription && currentPlanId === planId && planId !== "try_free";

          let cta = features.cta;
          let action: "trial" | "checkout" | "portal" =
            planId === "try_free" ? "trial" : "checkout";

          if (!isSignedIn) {
            cta = "Sign in to choose";
          } else if (planId === "try_free") {
            action = "trial";
          } else if (!hasBillingAccount) {
            cta = "Subscribe";
            action = "checkout";
          } else if (isCurrentPlan) {
            cta = "Manage billing";
            action = "portal";
          } else {
            cta = `Switch to ${PLAN_LABELS[planId]}`;
            action = "portal";
          }
          return (
            <div
              key={planId}
              className={`${styles.planCard} ${comingSoon ? styles.planCardComingSoon : ""}`}
            >
              <h2>{PLAN_LABELS[planId]}</h2>
              {isCurrentPlan && (
                <p className={styles.currentPlanLabel}>Current plan</p>
              )}
              {comingSoon && (
                <p className={styles.comingSoon}>Coming soon</p>
              )}
              <div className={styles.price}>{features.price}</div>
              {features.period && (
                <p className={styles.period}>{features.period}</p>
              )}
              <ul>
                {features.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className={styles.planActions}>
                <PricingPlanActions
                  planId={planId}
                  cta={cta}
                  isSignedIn={isSignedIn}
                  hasActiveTrialOrPlan={hasActiveTrialOrPlan}
                  action={action}
                  disabled={isDisabled}
                />
              </div>
            </div>
          );
        })}
      </section>

      <p className={styles.note}>
        Limits are based on monthly uploads and metadata generations. Agency is coming soon.
      </p>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
