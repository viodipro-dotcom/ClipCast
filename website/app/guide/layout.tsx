import Link from "next/link";
import { GuideSearch } from "@/components/GuideSearch";
import { GuideRightPanel } from "@/components/GuideRightPanel";
import { GUIDE_PAGES } from "@/lib/guideConfig";
import styles from "./layout.module.css";

export default function GuideLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.wrapper}>
      <aside className={`${styles.panelBase} ${styles.leftPanel}`} aria-label="Guide navigation">
        <div className={styles.searchWrap}>
          <GuideSearch />
        </div>
        <nav className={styles.nav}>
          {GUIDE_PAGES.map(({ slug, title }) => (
            <Link
              key={slug || "index"}
              href={slug ? `/guide/${slug}` : "/guide"}
              className={styles.navLink}
            >
              {title}
            </Link>
          ))}
        </nav>
      </aside>
      <div className={`${styles.panelBase} ${styles.centerPanel}`}>
        {children}
      </div>
      <div className={`${styles.panelBase} ${styles.rightPanel}`}>
        <GuideRightPanel />
      </div>
    </div>
  );
}
