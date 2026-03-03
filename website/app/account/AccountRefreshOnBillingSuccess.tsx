"use client";

import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * When the user lands on /account?billing=success, trigger a single router.refresh()
 * so the server component re-fetches entitlement and subscription and the UI shows
 * the updated plan without a full page reload.
 */
export function AccountRefreshOnBillingSuccess() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const didRefresh = useRef(false);

  useEffect(() => {
    if (didRefresh.current) return;
    if (searchParams.get("billing") === "success") {
      didRefresh.current = true;
      router.refresh();
    }
  }, [searchParams, router]);

  return null;
}
