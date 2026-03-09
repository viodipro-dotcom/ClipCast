import styles from "@/app/account/page.module.css";
import type { UsageSummary } from "@/lib/usage/getUsage";

type Props = {
  signedIn: boolean;
  usage: UsageSummary | null;
};

function formatLimit(limit?: number | null): string {
  if (limit == null) return "Unlimited";
  return limit.toLocaleString("en-GB");
}

function formatRemaining(used: number, limit?: number | null): string {
  if (limit == null) return "Unlimited";
  return Math.max(limit - used, 0).toLocaleString("en-GB");
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type UsageRowProps = {
  label: string;
  used: number;
  limit?: number | null;
};

function UsageRow({ label, used, limit }: UsageRowProps) {
  return (
    <div className={`${styles.row} ${styles.usageRow}`}>
      <span className={styles.usageLabel}>{label}</span>
      <span className={styles.usageValue}>
        {used.toLocaleString("en-GB")} / {formatLimit(limit)} used
      </span>
      <span className={styles.usageValue}>Remaining: {formatRemaining(used, limit)}</span>
    </div>
  );
}

export function UsageCard({ signedIn, usage }: Props) {
  if (!signedIn) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Usage (this period)</h2>
        <p className={styles.configMessage}>Sign in to see usage.</p>
      </section>
    );
  }

  if (!usage?.configured) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Usage (this period)</h2>
        {/* TODO: Replace with live usage once tables/RPCs are deployed. */}
        <p className={styles.configMessage}>Usage tracking not configured yet.</p>
      </section>
    );
  }

  const uploadsUsed = usage.uploadsUsed ?? 0;
  const metadataUsed = usage.metadataUsed ?? 0;
  const uploadsLimit = usage.uploadsLimit ?? null;
  const metadataLimit = usage.metadataLimit ?? null;
  const periodEndLabel = formatDate(usage.periodEnd);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Usage (this period)</h2>
      <UsageRow label="Uploads" used={uploadsUsed} limit={uploadsLimit} />
      <UsageRow label="Metadata" used={metadataUsed} limit={metadataLimit} />
      <div className={styles.row}>Resets on: {periodEndLabel}</div>
    </section>
  );
}
