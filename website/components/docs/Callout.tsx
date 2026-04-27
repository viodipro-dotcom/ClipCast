import type { ReactNode } from "react";
import styles from "./Callout.module.css";

type CalloutType = "info" | "warning" | "tip";

type Props = {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
};

export function Callout({ type = "info", title, children }: Props) {
  const label = title ?? type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <aside className={`${styles.callout} ${styles[type]}`} role="note">
      <p className={styles.title}>{label}</p>
      <div className={styles.content}>{children}</div>
    </aside>
  );
}
