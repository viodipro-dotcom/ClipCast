import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import {
  isStripeConfigured,
  getStripeSecretKey,
  getStripePriceId,
  getSiteUrl,
  isPurchasablePlan,
  isComingSoonPlan,
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

export async function POST(request: Request) {
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

  let body: { planId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_BODY", message: "Invalid JSON." },
      { status: 400 }
    );
  }
  const planId = body?.planId;
  if (!planId || typeof planId !== "string") {
    return NextResponse.json(
      { ok: false, code: "INVALID_PLAN", message: "planId is required." },
      { status: 400 }
    );
  }
  if (isComingSoonPlan(planId)) {
    return NextResponse.json(
      {
        ok: false,
        code: "PLAN_NOT_AVAILABLE",
        message: "Agency plan is coming soon.",
      },
      { status: 400 }
    );
  }
  if (!isPurchasablePlan(planId)) {
    return NextResponse.json(
      { ok: false, code: "INVALID_PLAN", message: "Invalid plan." },
      { status: 400 }
    );
  }

  if (!isStripeConfigured()) {
    console.warn("[create-checkout-session] STRIPE_SECRET_KEY not set");
    return notConfigured();
  }

  const secret = getStripeSecretKey();
  if (!secret) {
    return notConfigured();
  }

  const priceId = getStripePriceId(planId);
  if (!priceId) {
    const envVar =
      planId === "basic"
        ? "STRIPE_PRICE_ID_BASIC"
        : planId === "pro"
          ? "STRIPE_PRICE_ID_PRO"
          : "STRIPE_PRICE_ID_PRO_PLUS";
    console.warn(`[create-checkout-session] Missing ${envVar} for plan ${planId}`);
    return NextResponse.json(
      {
        ok: false,
        code: "PRICE_ID_MISSING",
        error: "PRICE_ID_MISSING",
        message: `Stripe Price ID not configured for ${planId}. Set ${envVar} in Vercel env.`,
      },
      { status: 503 }
    );
  }

  const baseUrl = getSiteUrl() || (request.headers.get("origin") ?? "http://localhost:3000");
  const successUrl = `${baseUrl}/account?billing=success`;
  const cancelUrl = `${baseUrl}/pricing?billing=cancelled`;

  try {
    const stripe = new Stripe(secret, { apiVersion: "2023-10-16" });

    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("customer_id, status, price_id, cancel_at_period_end")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasActiveOrTrialing =
      !!existingSub &&
      (existingSub.status === "active" || existingSub.status === "trialing") &&
      !!existingSub.customer_id;

    // If the user already has an active/trialing subscription, always route to the
    // billing portal instead of creating another checkout session. This prevents
    // duplicate purchases of the same or different plan.
    if (hasActiveOrTrialing && existingSub.customer_id) {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: existingSub.customer_id,
        return_url: `${baseUrl}/account`,
      });
      const portalUrl = portalSession.url;
      if (!portalUrl) {
        return NextResponse.json(
          { ok: false, code: "STRIPE_ERROR", message: "No portal URL returned." },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: true, url: portalUrl });
    }

    const idempotencyKey = `checkout_${user.id}_${planId}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: {
        user_id: user.id,
        plan_key: planId,
        supabase_user_id: user.id,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_key: planId,
          supabase_user_id: user.id,
        },
      },
    }, { idempotencyKey });
    const url = session.url;
    if (!url) {
      return NextResponse.json(
        { ok: false, code: "STRIPE_ERROR", message: "No checkout URL returned." },
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
