import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeSecretKey, getStripeWebhookSecret, getPlanKeyFromStripePriceId } from "@/lib/billing/config";
import {
  upsertSubscriptionFromStripeEvent,
  updateEntitlementsFromPlan,
  getUserIdByCustomerId,
} from "@/lib/billing/subscription-sync";

/** Stripe subscription statuses we treat as "active" for entitlements. */
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

/** Stripe subscription statuses that mean the user no longer has access. */
const ENDED_SUBSCRIPTION_STATUSES = ["canceled", "unpaid", "incomplete", "incomplete_expired", "past_due", "paused"];

function isActiveStatus(status: string): boolean {
  return ACTIVE_SUBSCRIPTION_STATUSES.includes(status);
}

export async function POST(request: Request) {
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  let body: string;
  try {
    body = await request.text();
  } catch (e) {
    console.error("[stripe-webhook] Failed to read body:", e);
    return NextResponse.json(
      { error: "Invalid body" },
      { status: 400 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    console.error("[stripe-webhook] Missing stripe-signature header");
    return NextResponse.json(
      { error: "Missing stripe-signature" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("[stripe-webhook] Signature verification failed:", message);
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 }
    );
  }

  const secret = getStripeSecretKey();
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_SECRET_KEY not set");
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 500 }
    );
  }

  const stripe = new Stripe(secret, { apiVersion: "2023-10-16" });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subscriptionId) {
          console.error("[stripe-webhook] checkout.session.completed: no subscription id");
          break;
        }
        const userId =
          session.client_reference_id ??
          (session.metadata?.user_id ?? session.metadata?.supabase_user_id);
        if (!userId) {
          console.error("[stripe-webhook] checkout.session.completed: no user_id in client_reference_id or metadata");
          break;
        }
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const planKey = priceId ? getPlanKeyFromStripePriceId(priceId) : undefined;
        await upsertSubscriptionFromStripeEvent(
          {
            id: subscription.id,
            customer: subscription.customer as string,
            status: subscription.status,
            items: subscription.items,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at ?? undefined,
            canceled_at: subscription.canceled_at ?? undefined,
            ended_at: subscription.ended_at ?? undefined,
          },
          userId
        );
        if (planKey && isActiveStatus(subscription.status)) {
          await updateEntitlementsFromPlan(userId, planKey, "active");
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscriptionFromEvent = event.data.object as Stripe.Subscription;
        const subscriptionId = subscriptionFromEvent.id;
        const customerId = subscriptionFromEvent.customer as string;
        let userId: string | null =
          (subscriptionFromEvent.metadata?.user_id ?? subscriptionFromEvent.metadata?.supabase_user_id) ||
          (await getUserIdByCustomerId(customerId));
        if (!userId) {
          console.error("[stripe-webhook]", event.type, ": could not resolve user_id for customer", customerId);
          break;
        }
        let subscription: Stripe.Subscription;
        try {
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        } catch {
          subscription = subscriptionFromEvent;
        }
        await upsertSubscriptionFromStripeEvent(
          {
            id: subscription.id,
            customer: subscription.customer as string,
            status: subscription.status,
            items: subscription.items,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            cancel_at: subscription.cancel_at ?? undefined,
            canceled_at: subscription.canceled_at ?? undefined,
            ended_at: subscription.ended_at ?? undefined,
          },
          userId
        );
        const priceId = subscription.items?.data?.[0]?.price?.id;
        const planKey = priceId ? getPlanKeyFromStripePriceId(priceId) : undefined;
        if (event.type === "customer.subscription.deleted") {
          await updateEntitlementsFromPlan(userId, "try_free", "inactive");
        } else if (isActiveStatus(subscription.status) && planKey) {
          await updateEntitlementsFromPlan(userId, planKey, "active");
        } else if (ENDED_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
          await updateEntitlementsFromPlan(userId, planKey ?? "try_free", "inactive");
        }
        break;
      }

      default:
        // Unhandled event type – acknowledge to avoid Stripe retries
        break;
    }
  } catch (err) {
    console.error("[stripe-webhook] Handler error:", err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}
