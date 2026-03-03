import { NextResponse } from "next/server";

/**
 * Placeholder for Stripe Customer Portal session.
 * When STRIPE_SECRET_KEY is configured, this route will create a portal
 * session and return the URL for managing billing.
 */
export async function POST() {
  return NextResponse.json(
    { message: "Stripe not configured yet" },
    { status: 501 }
  );
}
