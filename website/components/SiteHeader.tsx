import Image from "next/image";
import Link from "next/link";
import styles from "./SiteHeader.module.css";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/download", label: "Download" },
  { href: "/guide", label: "Guide" },
  { href: "/support", label: "Support" },
] as const;

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          <Image
            src="/logo.png"
            alt="ClipCast"
            width={44}
            height={44}
            className={styles.logoImage}
          />
          ClipCast
        </Link>
        <nav className={styles.nav}>
          {navItems.map(({ href, label }) => (
            <Link key={label} href={href} className={styles.navLink}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
