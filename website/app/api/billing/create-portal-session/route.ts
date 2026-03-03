import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import {
  isStripeConfigured,
  getStripeSecretKey,
  getSiteUrl,
} from "@/lib/billing/config";

const STRIPE_NOT_CONFIGURED = {
  ok: false as const,
  code: "STRIPE_NOT_CONFIGURED" as const,
  error: "STRIPE_NOT_CONFIGURED" as const,
  message: "Billing is not configured yet.",
};

function notConfigured() {
  console.info("[billing] Stripe not configured");
  return NextResponse.json(STRIPE_NOT_CONFIGURED, { status: 503 });
}

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

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("customer_id")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const customerId = sub?.customer_id ?? null;
  if (!customerId) {
    return NextResponse.json(
      { ok: false, code: "NO_CUSTOMER", message: "No billing account found. Subscribe to a plan first." },
      { status: 400 }
    );
  }

  if (!isStripeConfigured()) {
    return notConfigured();
  }

  const secret = getStripeSecretKey();
  if (!secret) {
    return notConfigured();
  }

  const baseUrl = getSiteUrl() || "http://localhost:3000";
  const returnUrl = `${baseUrl}/account`;

  try {
    const stripe = new Stripe(secret, { apiVersion: "2023-10-16" });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    const url = session.url;
    if (!url) {
      return NextResponse.json(
        { ok: false, code: "STRIPE_ERROR", message: "No portal URL returned." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    return NextResponse.json(
      { ok: false, code: "STRIPE_ERROR", message },
      { status: 502 }
    );
  }
}
