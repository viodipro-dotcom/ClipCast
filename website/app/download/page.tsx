import styles from "./page.module.css";
import {
  getLatestReleaseInfo,
  LATEST_RELEASE_URL,
  RELEASES_PAGE_URL,
} from "@/lib/releases";

export default async function DownloadPage() {
  const releaseInfo = await getLatestReleaseInfo();
  const versionLabel = releaseInfo?.version ?? "Latest";
  const downloadHref = releaseInfo?.installerUrl ?? RELEASES_PAGE_URL;
  const releaseNotesHref = releaseInfo?.releaseUrl ?? LATEST_RELEASE_URL;
  const isFallback = !releaseInfo?.installerUrl;

  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <h1>Download ClipCast</h1>
        <p className={styles.subtitle}>
          Install the desktop app for Windows.
        </p>
        <p className={styles.platformNote}>
          Currently available for Windows 10/11 only.
        </p>
      </section>

      <section className={styles.downloads}>
        <div className={styles.card}>
          <div className={styles.platformHeader}>
            <span className={styles.platformIcon} aria-hidden>
              🪟
            </span>
            <div>
              <h2>Windows installer</h2>
              <p className={styles.platformText}>
                Download the latest ClipCast desktop app for Windows.
              </p>
            </div>
          </div>
          <div className={styles.downloadActions}>
            <a
              className={styles.downloadBtn}
              href={downloadHref}
              target="_blank"
              rel="noreferrer"
            >
              Download for Windows
            </a>
            <a
              className={styles.ctaSecondary}
              href={releaseNotesHref}
              target="_blank"
              rel="noreferrer"
            >
              View release notes
            </a>
          </div>
          <div className={styles.downloadMeta}>
            <span>Version: {versionLabel}</span>
            <span>File type: .exe</span>
            <span>Auto-update supported</span>
          </div>
          {isFallback && (
            <p className={styles.fallbackNote}>
              Latest installer available on GitHub Releases.
            </p>
          )}
        </div>
      </section>

      <section className={styles.requirements}>
        <h2>System requirements</h2>
        <ul className={styles.requirementsList}>
          <li>Windows 10 or 11 (64-bit).</li>
          <li>
            Internet required for sign-in, metadata, billing checks, and uploads.
          </li>
        </ul>
      </section>

      <p className={styles.back}>
        <a href="/">← Back to Home</a>
      </p>
    </div>
  );
}
