import type { ReactNode } from "react";
import styles from "./Steps.module.css";

type Props = {
  children: ReactNode;
};

export function Steps({ children }: Props) {
  return <ol className={styles.steps}>{children}</ol>;
}
