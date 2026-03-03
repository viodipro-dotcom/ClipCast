import Link from "next/link";
import styles from "./page.module.css";

export default function SupportPage() {
  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <h1>Support</h1>
        <p className={styles.subtitle}>
          Get help with ClipCast. Check the guide first, then use diagnostics if you need to troubleshoot.
        </p>
      </section>

      <section className={styles.sections}>
        <div className={styles.card}>
          <h2>📖 Documentation</h2>
          <p>The <Link href="/guide">Guide</Link> explains how to use the app step by step — importing, scheduling, Auto Plan, Auto Upload, and Manual Assist.</p>
        </div>
        <div className={styles.card}>
          <h2>🧯 Troubleshooting</h2>
          <p>See the <Link href="/guide/troubleshooting">Troubleshooting</Link> page for common issues: pipeline failures, YouTube connection, port conflicts, file not found.</p>
        </div>
        <div className={styles.card}>
          <h2>❓ FAQ</h2>
          <p>Frequently asked questions are in the <Link href="/guide/faq">FAQ</Link> section of the guide.</p>
        </div>
        <div className={styles.card}>
          <h2>🔧 Diagnostics</h2>
          <p>In the app: <strong>More options (⋮)</strong> → <strong>Advanced</strong> → <strong>Diagnostics</strong>. Use System Info and logs when reporting issues.</p>
        </div>
        <div className={styles.card}>
          <h2>📬 Contact</h2>
          <p>
            Report an issue or get help:{" "}
            <a href="mailto:support@clipcast.app">support@clipcast.app</a>.
            Include <strong>Diagnostics</strong> logs when reporting.
          </p>
        </div>
      </section>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
