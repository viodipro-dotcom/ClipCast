"use client";

import { useState } from "react";
import styles from "./StepBlock.module.css";

type Props = {
  src: string;
  alt: string;
};

/** Renders guide step image. On load error shows a neutral placeholder (no "Image not found" text). */
export function StepBlockImage({ src, alt }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={styles.imageWrap} aria-hidden>
        <div className={styles.imagePlaceholder}>Screenshot</div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} onError={() => setFailed(true)} />
  );
}
