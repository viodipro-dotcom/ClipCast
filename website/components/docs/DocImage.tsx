"use client";

import { useState } from "react";
import styles from "./DocImage.module.css";

type Props = {
  src: string;
  alt: string;
  caption?: string;
};

export function DocImage({ src, alt, caption }: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <figure className={styles.figure}>
      <div className={styles.imageWrap}>
        {failed ? (
          <div className={styles.fallback} aria-hidden>
            Image not found
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            className={styles.image}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {caption != null && caption !== "" && (
        <figcaption className={styles.caption}>{caption}</figcaption>
      )}
    </figure>
  );
}
