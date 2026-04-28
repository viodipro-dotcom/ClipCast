import Link from "next/link";
import styles from "./page.module.css";

export default function CookiesPage() {
  return (
    <div className={styles.container}>
      <h1>Cookie Policy</h1>
      <p className={styles.updated}>Last updated: 27 April 2026</p>

      <section className={styles.section}>
        <h2>This website</h2>
        <p>
          This marketing site does not offer sign-in or user accounts. We do not place cookies for the
          purpose of keeping you logged in to ClipCast on this website.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Technical cookies</h2>
        <p>
          Your browser or our hosting infrastructure may use strictly necessary technical mechanisms (such
          as cookies or similar storage) for basic delivery, stability, load balancing, or security.
          Those are not used by us for advertising or profiling.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Analytics and marketing</h2>
        <p>
          We do not use analytics or marketing cookies on this site. If we ever introduce optional,
          non-essential cookies, we will update this page and obtain consent where required by law.
        </p>
      </section>

      <section className={styles.section}>
        <h2>More information</h2>
        <p>
          For how we handle personal data overall, see our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
