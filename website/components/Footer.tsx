import Link from "next/link";
import styles from "./Footer.module.css";

const currentYear = new Date().getFullYear();

const footerLinks = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/support", label: "Support" },
] as const;

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <p className={styles.copyright}>
            © {currentYear} ClipCast. All rights reserved.
          </p>
          <p className={styles.tagline}>
            ClipCast is a local-first desktop app + companion website.
          </p>
        </div>
        <nav className={styles.links} aria-label="Footer">
          {footerLinks.map(({ href, label }) => (
            <Link key={label} href={href} className={styles.link}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
