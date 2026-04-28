import Link from "next/link";
import styles from "./page.module.css";

export default function PrivacyPage() {
  return (
    <div className={styles.container}>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: 27 April 2026</p>

      <section className={styles.section}>
        <h2>1. This website</h2>
        <p>
          This site is mostly static (product information, documentation, and download links). We do not
          run account sign-in or a ClipCast-operated user database on this website. Normal web hosting may
          log technical data (for example IP address and browser type) for security and operations.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. Open source and local-first software</h2>
        <p>
          The ClipCast desktop app is open source. We do not operate a proprietary “ClipCast cloud”
          backend for app accounts or subscriptions on your behalf in the manner described here; we do
          not use Supabase or Stripe for this project as shipped from our public repository. You build or
          install the app yourself and control your own files and credentials (including optional API
          keys), consistent with our README.
        </p>
      </section>

      <section className={styles.section}>
        <h2>3. Desktop application</h2>
        <p>
          The ClipCast app runs on your computer. If you connect YouTube or add an API key (for example
          OpenAI), those providers process data under their own terms; we do not receive your keys on
          this website.
        </p>
      </section>

      <section className={styles.section}>
        <h2>4. Contact</h2>
        <p>
          For privacy-related requests or questions, contact us at{" "}
          <a href="mailto:support@getclipcast.app">support@getclipcast.app</a>.
        </p>
      </section>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
