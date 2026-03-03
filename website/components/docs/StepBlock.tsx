import type { ReactNode } from "react";
import styles from "./StepBlock.module.css";
import { StepBlockImage } from "./StepBlockImage";

type Props = {
  title: string;
  children: ReactNode;
  imageSrc: string;
  imageAlt: string;
  caption?: string;
  align?: "left" | "right";
};

export function StepBlock({
  title,
  children,
  imageSrc,
  imageAlt,
  caption,
  align = "right",
}: Props) {
  const blockClass = align === "left" ? `${styles.block} ${styles.blockLeft}` : styles.block;

  return (
    <section className={blockClass}>
      <div className={styles.textColumn}>
        <h3 className={styles.blockTitle}>{title}</h3>
        <div className={styles.blockBody}>{children}</div>
      </div>
      <div className={styles.imageColumn}>
        <div className={styles.imageWrap}>
          <StepBlockImage src={imageSrc} alt={imageAlt} />
        </div>
        {caption != null && caption !== "" && (
          <p className={styles.caption}>{caption}</p>
        )}
      </div>
    </section>
  );
}
