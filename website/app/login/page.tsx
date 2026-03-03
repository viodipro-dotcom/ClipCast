import { LoginWithGoogle } from "./LoginWithGoogle";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <div className={styles.container}>
      <h1>Sign in</h1>
      <LoginWithGoogle />
    </div>
  );
}
