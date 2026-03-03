"use client";

import { useState } from "react";
import styles from "./page.module.css";

type ManageBillingButtonProps = {
  hasCustomer: boolean;
};

export function ManageBillingButton({ hasCustomer }: ManageBillingButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setMessage(null);
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
      if (
        data.code === "STRIPE_NOT_CONFIGURED" ||
        data.error === "STRIPE_NOT_CONFIGURED"
      ) {
        setMessage("Billing not configured yet. Stripe will be enabled soon.");
        return;
      }
      if (data.code === "NO_CUSTOMER") {
        setMessage("No billing account found. Subscribe to a plan first.");
        return;
      }
      setMessage(data.message || "Could not open billing.");
    } catch {
      setMessage("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={styles.button}
        disabled={loading || !hasCustomer}
        onClick={handleClick}
      >
        {loading ? "Loading…" : "Manage billing"}
      </button>
      {message && (
        <p className={styles.billingMessage} role="alert">
          {message}
        </p>
      )}
    </>
  );
}
