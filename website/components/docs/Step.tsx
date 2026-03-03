import type { ReactNode } from "react";
import { DocImage } from "./DocImage";
import styles from "./Step.module.css";

type Props = {
  number: number;
  title: string;
  children: ReactNode;
  imageSrc: string;
  imageAlt: string;
  imageCaption: string;
};

export function Step({
  number,
  title,
  children,
  imageSrc,
  imageAlt,
  imageCaption,
}: Props) {
  return (
    <section className={styles.step}>
      <h3 className={styles.title}>
        Step {number} — {title}
      </h3>
      <div className={styles.body}>{children}</div>
      <div className={styles.imageWrap}>
        <DocImage
          src={imageSrc}
          alt={imageAlt}
          caption={imageCaption}
        />
      </div>
    </section>
  );
}
