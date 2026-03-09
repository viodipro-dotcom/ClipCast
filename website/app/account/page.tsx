import Link from "next/link";
import {
  getCurrentUser,
  getCurrentUserEntitlement,
  getCurrentUserSubscription,
} from "@/lib/supabase/server";
import { planDisplayName } from "@/lib/plans";
import { getUsage } from "@/lib/usage/getUsage";
import { UsageCard } from "@/components/account/UsageCard";
import { AccountSection } from "./AccountSection";
import { AccountErrorBanner } from "./AccountErrorBanner";
import { ManageBillingButton } from "./ManageBillingButton";
import { AccountRefreshOnBillingSuccess } from "./AccountRefreshOnBillingSuccess";
import styles from "./page.module.css";

type SearchParams = {
  error?: string;
  billing?: string;
  trial?: string;
  message?: string;
} | Promise<{ error?: string; billing?: string; trial?: string; message?: string }>;

export default async function AccountPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params =
    searchParams && typeof (searchParams as Promise<unknown>).then === "function"
      ? await (searchParams as Promise<{
          error?: string;
          billing?: string;
          trial?: string;
          message?: string;
        }>)
      : (searchParams as
          | { error?: string; billing?: string; trial?: string; message?: string }
          | undefined);

  const errorCode = params?.error;
  const billingResult = params?.billing;
  const trialResult = params?.trial;
  const infoMessage = params?.message;

  const [user, entitlement, subscription, usage] = await Promise.all([
    getCurrentUser(),
    getCurrentUserEntitlement(),
    getCurrentUserSubscription(),
    getUsage(),
  ]);

  const supabaseConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const plan = entitlement?.plan ?? "try_free";
  const status = entitlement?.status ?? "inactive";
  const planLabel = planDisplayName(plan);

  const isCancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);

  // Date to show: prefer current_period_end; when canceling, fallback to cancel_at (synced from Stripe)
  const periodEndTimestamp =
    subscription?.current_period_end ??
    (isCancelAtPeriodEnd && subscription?.cancel_at ? subscription.cancel_at : null);
  const periodEndDate = periodEndTimestamp
    ? new Date(periodEndTimestamp).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const trialEndsAt = entitlement?.trial_ends_at
    ? new Date(entitlement.trial_ends_at).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const statusLabel =
    status === "active"
      ? isCancelAtPeriodEnd
        ? "Active — cancels at period end"
        : "Active"
      : status === "canceled"
        ? "Canceled"
        : plan === "try_free"
          ? "Trial"
          : "Inactive";

  const dateLabel =
    status === "active" && isCancelAtPeriodEnd ? "Ends on" : "Renewal date";

  const hasCustomer = !!subscription?.customer_id;

  return (
    <div className={styles.container}>
      <AccountRefreshOnBillingSuccess />
      <h1>Account</h1>

      {errorCode && <AccountErrorBanner errorCode={errorCode} />}

      {trialResult === "activated" && (
        <p className={styles.successMessage} role="status">
          Your free trial is now active.
        </p>
      )}

      {billingResult === "success" && (
        <p className={styles.successMessage} role="status">
          Thank you. Your subscription is updated.
        </p>
      )}

      {infoMessage === "sign-in-required" && (
        <p className={styles.configMessage} role="status">
          Sign in to start your free trial or upgrade your plan.
        </p>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Account</h2>
        <AccountSection initialUser={user} supabaseConfigured={supabaseConfigured} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Subscription</h2>

        <div className={styles.row}>Plan: {planLabel}</div>

        <div className={styles.row}>
          Status: <span data-status={status}>{statusLabel}</span>
        </div>

        {(status === "active" || periodEndDate) && (
          <div className={styles.row}>
            {dateLabel}: {periodEndDate ?? "(unavailable)"}
          </div>
        )}

        {trialEndsAt && (
          <div className={styles.row}>Trial ends: {trialEndsAt}</div>
        )}

        <div className={styles.actions}>
          <Link href="/pricing" className={styles.button}>
            Update Plan
          </Link>
          <ManageBillingButton hasCustomer={hasCustomer} />
        </div>

        {!hasCustomer && user && (
          <p className={styles.configMessage}>
            Subscribe to a plan to manage billing and payment methods.
          </p>
        )}
      </section>

      <UsageCard signedIn={!!user} usage={usage} />

      {process.env.NODE_ENV !== "production" && (
        <section className={styles.section} aria-label="Debug info">
          {/* Dev/debug: session and entitlement state (no secrets) */}
          <h2 className={styles.sectionTitle}>Debug</h2>
          <div className={styles.debugRow}>
            Session: {user ? "signed in" : "not signed in"}
          </div>
          <div className={styles.debugRow}>
            Entitlement: {entitlement ? "loaded" : "not loaded"}
            {entitlement && (
              <> — plan: {planLabel}, status: {entitlement.status}</>
            )}
          </div>
          <div className={styles.debugRow}>
            Subscription cancel_at_period_end:{" "}
            {subscription?.cancel_at_period_end ? "true" : "false"}
            {subscription?.cancel_at != null && (
              <> — cancel_at: {new Date(subscription.cancel_at).toISOString()}</>
            )}
            {subscription?.current_period_end != null && (
              <> — current_period_end: {new Date(subscription.current_period_end).toISOString()}</>
            )}
          </div>
        </section>
      )}

      <p className={styles.help}>
        After signing in you can upgrade your plan and manage billing from this
        page.
      </p>
    </div>
  );
}