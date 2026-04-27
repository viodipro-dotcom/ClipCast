import Link from "next/link";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <div className={styles.container}>
      <h1>Sign in</h1>
      <p className={styles.subtitle}>
        Web sign-in is not available. Install the ClipCast desktop app and use{" "}
        <strong>Settings → Integrations</strong> to connect YouTube and add your OpenAI key locally.
      </p>
      <p className={styles.subtitle}>
        <Link href="/download" className={styles.button}>
          Go to download
        </Link>
      </p>
    </div>
  );
}
