"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlanId } from "@/lib/plans";
import { isPlanComingSoon } from "@/lib/plans";
import styles from "./page.module.css";

type PricingPlanActionsProps = {
  planId: PlanId;
  cta: string;
  isSignedIn: boolean;
  hasActiveTrialOrPlan: boolean;
  action: "trial" | "checkout" | "portal";
  disabled?: boolean;
};

export function PricingPlanActions({
  planId,
  cta,
  isSignedIn,
  hasActiveTrialOrPlan,
  action,
  disabled = false,
}: PricingPlanActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const comingSoon = isPlanComingSoon(planId);

  const handleTryFree = async () => {
    if (!isSignedIn) {
      router.push("/account?message=sign-in-required");
      return;
    }
    setLoading(true);
    setBillingMessage(null);
    try {
      const res = await fetch("/api/billing/activate-trial", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        router.push("/account?trial=activated");
        router.refresh();
        return;
      }
      setBillingMessage(data.message || "Could not activate trial.");
    } catch {
      setBillingMessage("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handlePaidPlan = async () => {
    if (!isSignedIn) {
      router.push("/login?returnTo=/pricing");
      return;
    }
    setLoading(true);
    setBillingMessage(null);
    try {
      const res = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        code?: string;
        error?: string;
        message?: string;
      };
      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      const message = data.message || "Checkout could not be started.";
      const visible = res.status > 0 ? `(${res.status}) ${message}` : message;
      setBillingMessage(visible);
    } catch (err) {
      const fallback = err instanceof Error ? err.message : "Something went wrong.";
      setBillingMessage(fallback);
    } finally {
      setLoading(false);
    }
  };

  const handlePortal = async () => {
    setLoading(true);
    setBillingMessage(null);
    try {
      const res = await fetch("/api/billing/create-portal-session", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        code?: string;
        error?: string;
        message?: string;
      };
      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      const message = data.message || "Could not open billing.";
      const visible = res.status > 0 ? `(${res.status}) ${message}` : message;
      setBillingMessage(visible);
    } catch (err) {
      const fallback = err instanceof Error ? err.message : "Something went wrong.";
      setBillingMessage(fallback);
    } finally {
      setLoading(false);
    }
  };

  if (disabled || comingSoon) {
    return <span className={styles.planBtnDisabled}>{cta}</span>;
  }

  if (planId === "try_free") {
    const tryFreeDisabled = hasActiveTrialOrPlan || loading;
    return (
      <>
        <button
          type="button"
          className={styles.planBtn}
          disabled={tryFreeDisabled}
          onClick={handleTryFree}
        >
          {loading ? "Activating…" : cta}
        </button>
        {planId === "try_free" && (
          <Link href="/guide" className={styles.ctaSecondary}>
            Read the guide
          </Link>
        )}
        {billingMessage && (
          <p className={styles.billingMessage} role="alert">
            {billingMessage}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.planBtn}
        disabled={loading}
        onClick={async () => {
          if (!isSignedIn) {
            router.push("/login?returnTo=/pricing");
            return;
          }
          if (action === "portal") {
            await handlePortal();
          } else {
            await handlePaidPlan();
          }
        }}
      >
        {loading ? "Loading…" : cta}
      </button>
      {billingMessage && (
        <p className={styles.billingMessage} role="alert">
          {billingMessage}
        </p>
      )}
    </>
  );
}
