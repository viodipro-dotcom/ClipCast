"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "@/app/account/page.module.css";
import loginStyles from "./page.module.css";

/** Base URL for OAuth redirect; prefer NEXT_PUBLIC_SITE_URL, fallback to window origin. Use localhost in dev. */
function getRedirectBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  }
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl;
  const origin = window.location.origin;
  if (process.env.NODE_ENV === "development" && origin.startsWith("http://127.0.0.1")) {
    return origin.replace("127.0.0.1", "localhost");
  }
  return origin;
}

/** Map Supabase auth errors to a safe, user-friendly message. Never expose tokens or raw error JSON. */
function getFriendlyErrorMessage(): string {
  return "Google sign-in is not available right now. Please try again later.";
}

export function LoginWithGoogle() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    const supabase = createClient();
    if (!supabase) {
      setError(getFriendlyErrorMessage());
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const baseUrl = getRedirectBaseUrl();
      const redirectTo = `${baseUrl}/auth/callback?next=/account`;
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });
      if (authError) {
        setError(getFriendlyErrorMessage());
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <p>
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className={`${styles.button} ${styles.buttonPrimary}`}
        >
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>
      </p>
      {error && (
        <p className={loginStyles.errorText} role="alert">
          {error}
        </p>
      )}
      <p>
        <Link href="/account" className={styles.button}>
          Back to account
        </Link>
      </p>
    </>
  );
}
