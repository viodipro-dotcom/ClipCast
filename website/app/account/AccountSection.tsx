"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { SignOutButton } from "./SignOutButton";
import styles from "./page.module.css";

type Props = {
  initialUser: User | null;
  supabaseConfigured: boolean;
};

export function AccountSection({ initialUser, supabaseConfigured }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(initialUser);

  const refreshSession = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setUser(session?.user ?? null);
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      router.refresh();
    });
    return () => subscription.unsubscribe();
  }, [router]);

  if (user) {
    return (
      <>
        <div className={styles.row}>
          Signed in as: {user.email ?? "—"}
        </div>
        <div className={styles.actions}>
          <SignOutButton />
        </div>
      </>
    );
  }

  if (!supabaseConfigured) {
    return (
      <>
        <div className={styles.row}>Not signed in</div>
        <p className={styles.configMessage}>
          Sign-in is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code> (see <code>example.env</code>).
        </p>
      </>
    );
  }

  return (
    <>
      <div className={styles.row}>Not signed in</div>
      <div className={styles.actions}>
        <Link
          href="/login"
          className={`${styles.button} ${styles.buttonPrimary}`}
        >
          Sign in with Google
        </Link>
      </div>
    </>
  );
}
