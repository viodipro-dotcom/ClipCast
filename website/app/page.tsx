import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";

const DEMO_ALT =
  "ClipCast: schedule and publish to YouTube, Instagram, and TikTok with AI metadata. Runs locally.";

export default function HomePage() {
  return (
    <div className={styles.container}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroContent}>
            <h1 className={styles.heroTitle}>ClipCast</h1>
            {/* Hero copy variants:
                A: Schedule and publish to YouTube, Instagram, and TikTok with AI-generated metadata. Runs locally — your data stays on your machine.
                B: AI metadata, scheduling, and publish to YouTube, Instagram, and TikTok. Desktop app that runs on your machine; your data never leaves it.
                Chosen: A — outcome-first (schedule + publish), then trust (local-first). */}
            <p className={styles.heroSubtitle}>
              Schedule and publish to YouTube, Instagram, and TikTok with AI-generated metadata. Runs locally — your data stays on your machine.
            </p>
            <div className={styles.heroActions}>
              <Link href="/download" className={styles.ctaPrimary}>
                Download app
              </Link>
              <Link href="/guide" className={styles.ctaSecondary}>
                Read the guide
              </Link>
            </div>
          </div>
          <div className={styles.heroDemo}>
            <figure className={styles.demoFigure}>
              <div className={styles.demoImageWrap}>
                {/* Placeholder: replace src with /demo.png for a real app screenshot */}
                <Image
                  src="/demo.svg"
                  alt={DEMO_ALT}
                  width={800}
                  height={500}
                  priority
                  sizes="(max-width: 768px) 100vw,  min(50vw, 480px)"
                  className={styles.demoImage}
                />
              </div>
              <figcaption className={styles.demoCaption}>
                Import → AI metadata → Schedule → Publish
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className={styles.trust} aria-label="Trust & privacy">
        <div className={styles.trustRow}>
          <div className={styles.trustChip}>
            <span className={styles.trustIcon} aria-hidden>💻</span>
            <div className={styles.trustText}>
              <span className={styles.trustLabel}>Runs locally</span>
              <span className={styles.trustLine}>Your data stays on your machine.</span>
            </div>
          </div>
          <div className={styles.trustChip}>
            <span className={styles.trustIcon} aria-hidden>☁️</span>
            <div className={styles.trustText}>
              <span className={styles.trustLabel}>No cloud uploads by default</span>
              <span className={styles.trustLine}>Videos and metadata stay local unless you publish.</span>
            </div>
          </div>
          <div className={styles.trustChip}>
            <span className={styles.trustIcon} aria-hidden>🔐</span>
            <div className={styles.trustText}>
              <span className={styles.trustLabel}>Secure OAuth sign-in</span>
              <span className={styles.trustLine}>Sign in with Google; tokens never leave your device.</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.features}>
        <h2>Everything you need to scale</h2>
        <div className={styles.featureGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📁</div>
            <h3>Import & organize</h3>
            <p>Add MP4 files or whole folders. Each video becomes a job. Auto Plan assigns publish times when you import.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🤖</div>
            <h3>AI metadata</h3>
            <p>Generate title, description, and hashtags with AI. Edit in the Details panel. Save templates for reuse.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🎯</div>
            <h3>Targets & visibility</h3>
            <p>Choose platforms per video: YouTube, Instagram, TikTok. Set visibility (Private / Unlisted / Public). Schedule per platform.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>⏰</div>
            <h3>Smart scheduling</h3>
            <p>Auto Plan, Plan dialog for bulk scheduling, or Schedule per video. Daily posting windows in local time.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🚀</div>
            <h3>YouTube auto upload</h3>
            <p>OAuth sign-in and automatic upload at scheduled time. Instagram and TikTok use Manual Assist when due.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📤</div>
            <h3>Manual Assist</h3>
            <p>For IG/TT: copy caption + hashtags, open upload page, reveal file. Silent Mode keeps it non-intrusive.</p>
          </div>
        </div>
      </section>

      <section className={styles.ctaSection}>
        <p>Get started in minutes. No account required to try.</p>
        <div className={styles.ctaSectionActions}>
          <Link href="/download" className={styles.ctaPrimary}>
            Download app
          </Link>
          <Link href="/guide" className={styles.ctaSecondary}>
            Read the guide
          </Link>
        </div>
      </section>
    </div>
  );
}
