import Link from "next/link";
import styles from "./NextLinks.module.css";

type LinkItem = { slug: string; label: string };

type Props = {
  next?: LinkItem;
  prev?: LinkItem;
};

function linkHref(slug: string): string {
  return slug ? `/guide/${slug}` : "/guide";
}

export function NextLinks({ next, prev }: Props) {
  if (!next && !prev) return null;

  return (
    <nav className={styles.nav} aria-label="Guide navigation">
      {prev && (
        <Link href={linkHref(prev.slug)} className={styles.link}>
          ← {prev.label}
        </Link>
      )}
      {next && (
        <Link
          href={linkHref(next.slug)}
          className={styles.link}
          style={prev ? { marginLeft: "auto" } : undefined}
        >
          {next.label} →
        </Link>
      )}
    </nav>
  );
}
