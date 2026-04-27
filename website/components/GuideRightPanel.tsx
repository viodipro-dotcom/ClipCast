"use client";

import styles from "./GuideRightPanel.module.css";

/**
 * Right panel for the Guide app shell. Optional context/help area.
 * Can be easily replaced or removed later; placeholder content for now.
 */
export function GuideRightPanel() {
  return (
    <aside className={styles.panel} aria-label="Tips and shortcuts">
      <h2 className={styles.title}>Tips</h2>
      <ul className={styles.list}>
        <li>Use the search to jump to features</li>
        <li>Screenshots match the desktop app UI</li>
        <li>Follow steps top-to-bottom</li>
      </ul>
    </aside>
  );
}
