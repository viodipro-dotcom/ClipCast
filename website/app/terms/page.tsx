import Link from "next/link";
import styles from "./page.module.css";

export default function TermsPage() {
  return (
    <div className={styles.container}>
      <h1>Terms of Service</h1>
      <p className={styles.updated}>Last updated: 3 Mar 2026</p>

      <section className={styles.section}>
        <h2>1. Service description</h2>
        <p>
          ClipCast is a desktop application and companion website that helps creators import videos, generate AI metadata, and schedule or publish content to YouTube, Instagram, and TikTok. Use of the website and app is subject to these terms.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. Accounts</h2>
        <p>
          You are responsible for keeping your account credentials secure and for all activity under your account. Do not share your login details with others.
        </p>
      </section>

      <section className={styles.section}>
        <h2>3. Subscriptions</h2>
        <p>
          Paid plans are billed on a recurring basis (e.g. monthly). Plan changes may be prorated. You may cancel at any time; access continues until the end of the current billing period. Cancellation stops future charges but does not refund the current period.
        </p>
      </section>

      <section className={styles.section}>
        <h2>4. Refunds</h2>
        <p>
          We do not offer refunds for partial billing periods. If you believe you have been charged in error or have an exceptional issue, contact us at{" "}
          <a href="mailto:support@clipcast.app">support@clipcast.app</a> and we will review your case.
        </p>
      </section>

      <section className={styles.section}>
        <h2>5. Acceptable use</h2>
        <p>
          You must not use ClipCast to abuse, harass, or harm others, or for any unlawful purpose. We may suspend or terminate accounts that violate these terms or applicable law.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Disclaimer</h2>
        <p>
          ClipCast is provided &quot;as is&quot; to the extent permitted by law. We do not guarantee uninterrupted or error-free service. We are not liable for indirect, incidental, or consequential damages arising from your use of the service.
        </p>
      </section>

      <section className={styles.section}>
        <h2>7. Contact</h2>
        <p>
          For questions about these terms, contact us at{" "}
          <a href="mailto:support@clipcast.app">support@clipcast.app</a>.
        </p>
      </section>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
