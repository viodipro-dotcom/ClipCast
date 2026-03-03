import Link from "next/link";
import styles from "./page.module.css";

export default function DownloadPage() {
  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <h1>Download ClipCast</h1>
        <p className={styles.subtitle}>
          Get the desktop app for Windows and macOS. Install once and run locally — your videos and metadata stay on your machine.
        </p>
        <p className={styles.heroActions}>
          <Link href="/guide" className={styles.ctaSecondary}>
            Read the guide
          </Link>
        </p>
      </section>

      <section className={styles.downloads}>
        <div className={styles.card}>
          <div className={styles.platformIcon}>🪟</div>
          <h2>Windows</h2>
          <p>Windows 10 or later (64-bit)</p>
          <p className={styles.muted}>Download the installer and run it. Requires Visual C++ Redistributable if not already installed.</p>
          <Link href="#" className={styles.downloadBtn}>
            Download
          </Link>
        </div>
        <div className={styles.card}>
          <div className={styles.platformIcon}>🍎</div>
          <h2>macOS</h2>
          <p>macOS 10.15 (Catalina) or later</p>
          <p className={styles.muted}>Download the .dmg file. On first launch, go to System Preferences → Security &amp; Privacy if the app is blocked.</p>
          <Link href="#" className={styles.downloadBtn}>
            Download
          </Link>
        </div>
      </section>

      <section className={styles.requirements}>
        <h2>Requirements</h2>
        <p className={styles.requirementsLead}>
          Most users can install and run in minutes.
        </p>
        <details className={styles.requirementsDetails}>
          <summary>Advanced requirements</summary>
          <ul>
            <li><strong>Python</strong> (metadata pipeline) — installed separately or bundled</li>
            <li><strong>YouTube</strong> — Google account with OAuth client (Desktop app type)</li>
            <li><strong>Storage</strong> — Space for pipeline outputs (transcripts, exports)</li>
          </ul>
        </details>
      </section>

      <p className={styles.back}>
        <Link href="/">← Back to Home</Link>
      </p>
    </div>
  );
}
