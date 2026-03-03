import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Trial duration in days (Try Free = 1 day). */
const TRIAL_DAYS = 1;

export async function POST() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, code: "AUTH_ERROR", message: "Not configured." },
      { status: 503 }
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", message: "Sign in required." },
      { status: 401 }
    );
  }

  const { data: existing } = await supabase
    .from("entitlements")
    .select("user_id, plan, status")
    .eq("user_id", user.id)
    .single();

  if (existing?.plan === "try_free" && existing?.status === "active") {
    return NextResponse.json(
      { ok: true, alreadyActive: true, message: "Trial is already active." },
      { status: 200 }
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const trialEndsAt = new Date(now);
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);
  const trialEndsAtIso = trialEndsAt.toISOString();

  const updatePayload: Record<string, unknown> = {
    plan: "try_free",
    status: "active",
    updated_at: nowIso,
  };
  const { error } = await supabase
    .from("entitlements")
    .update(updatePayload)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { ok: false, code: "UPDATE_FAILED", message: "Could not activate trial." },
      { status: 500 }
    );
  }
  try {
    await supabase
      .from("entitlements")
      .update({
        trial_used: true,
        trial_started_at: nowIso,
        trial_ends_at: trialEndsAtIso,
      } as Record<string, unknown>)
      .eq("user_id", user.id);
  } catch {
    // Trial columns may not exist; run migration 20250223110000_entitlements_trial_columns.sql to enable trial tracking
  }

  return NextResponse.json({
    ok: true,
    message: "Trial activated.",
    trial_ends_at: trialEndsAtIso,
  });
}
