import type { ReactNode } from "react";
import styles from "./DocPage.module.css";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function DocPage({ title, description, children }: Props) {
  return (
    <article className={styles.article}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {description != null && description !== "" && (
          <p className={styles.description}>{description}</p>
        )}
      </header>
      <div className={styles.body}>{children}</div>
    </article>
  );
}
