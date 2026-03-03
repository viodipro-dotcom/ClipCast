import Link from "next/link";
import styles from "./page.module.css";

export default function CookiesPage() {
  return (
    <div className={styles.container}>
      <h1>Cookie Policy</h1>
      <p className={styles.updated}>Last updated: 3 Mar 2026</p>

      <section className={styles.section}>
        <h2>What we use cookies for</h2>
        <p>
          We use strictly necessary cookies to run the ClipCast website. These are required for:
        </p>
        <ul>
          <li>Authentication and session management (so you stay signed in)</li>
          <li>Security (e.g. protecting against cross-site request forgery)</li>
        </ul>
        <p>
          These cookies are essential for the service to function. We do not use them for advertising or tracking.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Analytics and marketing</h2>
        <p>
          We do not currently use analytics or marketing cookies. If we add them in the future, we will ask for your consent before placing any non-essential cookies and will update this page.
        </p>
      </section>

      <section className={styles.section}>
        <h2>More information</h2>
        <p>
          For how we handle your personal data overall, see our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
