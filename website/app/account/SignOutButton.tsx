"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    router.refresh();
    router.push("/account");
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className={styles.button}
    >
      Sign out
    </button>
  );
}
