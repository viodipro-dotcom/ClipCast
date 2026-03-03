"use client";

import Link from "next/link";
import styles from "./page.module.css";

type Props = { errorCode: string };

const MESSAGES: Record<string, string> = {
  oauth_failed:
    "Sign-in did not complete. Please try again or use the link below to return to your account.",
};

export function AccountErrorBanner({ errorCode }: Props) {
  const message = MESSAGES[errorCode] ?? "Something went wrong. Please try again.";

  return (
    <div className={styles.errorBanner} role="alert">
      <p className={styles.errorBannerText}>{message}</p>
      <Link href="/account" className={styles.errorBannerLink}>
        Back to account
      </Link>
    </div>
  );
}
