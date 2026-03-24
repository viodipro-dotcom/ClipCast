import Link from "next/link";
import styles from "./page.module.css";

export default function PrivacyPage() {
  return (
    <div className={styles.container}>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: 3 Mar 2026</p>

      <section className={styles.section}>
        <h2>1. What we collect</h2>
        <p>We collect and process only what is needed to run the service:</p>
        <ul>
          <li>Email and account identifiers (via Google or Supabase authentication)</li>
          <li>Subscription status and plan (to enforce limits and show billing)</li>
          <li>Basic usage data necessary to operate the service (e.g. API usage for billing and support)</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>2. What we use it for</h2>
        <ul>
          <li>Authentication and account management</li>
          <li>Billing, invoices, and subscription management</li>
          <li>Support and replying to your requests</li>
          <li>Improving the product and fixing issues</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>3. Processors</h2>
        <p>We use the following service providers to run ClipCast:</p>
        <ul>
          <li><strong>Supabase</strong> — authentication and database</li>
          <li><strong>Stripe</strong> — payments, billing portal, and invoices</li>
        </ul>
        <p>Each processor has its own privacy and data processing commitments. We choose them with care and do not sell your data.</p>
      </section>

      <section className={styles.section}>
        <h2>4. Data retention</h2>
        <p>
          We keep your data while your account is active. You can request deletion of your account and associated data at any time by contacting us; we will process such requests in line with applicable law.
        </p>
      </section>

      <section className={styles.section}>
        <h2>5. Region and law</h2>
        <p>
          We serve users in the UK, EU, and elsewhere. We aim to comply with applicable data protection laws (including UK GDPR and EU GDPR where relevant). If you have rights under those laws (access, rectification, erasure, etc.), you may contact us to exercise them.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Contact</h2>
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
