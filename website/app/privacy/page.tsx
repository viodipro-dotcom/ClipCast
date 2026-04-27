import Link from "next/link";
import styles from "./page.module.css";

export default function PrivacyPage() {
  return (
    <div className={styles.container}>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: 3 Mar 2026</p>

      <section className={styles.section}>
        <h2>1. This website</h2>
        <p>
          This site is mostly static (product information, documentation, and download links). We do not run
          account sign-in or a user database on this website. Normal web hosting may log technical data
          (e.g. IP address, browser type) for security and operations.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. Desktop application</h2>
        <p>
          The ClipCast app runs on your computer. If you connect YouTube or add an API key (e.g. OpenAI),
          those providers process data under their own terms; we do not receive your keys on this website.
        </p>
      </section>

      <section className={styles.section}>
        <h2>3. Contact</h2>
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
