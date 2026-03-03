import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Allow only same-origin paths (e.g. /account, /dashboard). Reject protocol-relative or open redirects. */
function getSafeNextUrl(next: string | null, base: URL): URL {
  const path = (next ?? "").trim();
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return new URL("/account", base);
  }
  return new URL(path, base);
}

/**
 * OAuth callback: exchange auth code for session (PKCE; cookies), then redirect.
 * Uses server-side cookies so the code verifier set by the browser client is available.
 * Redirect uses NEXT_PUBLIC_SITE_URL when set (localhost in dev, production URL in prod).
 * Never renders JSON errors; always redirects to /account (or safe `next` param).
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next");
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? requestUrl.origin;
  const base = new URL(origin);
  const accountUrl = new URL("/account", base);
  const errorUrl = new URL("/account", base);
  errorUrl.searchParams.set("error", "oauth_failed");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.redirect(errorUrl);
  }

  if (!code) {
    return NextResponse.redirect(getSafeNextUrl(nextParam, base));
  }

  const successDest = getSafeNextUrl(nextParam ?? "/account", base);
  const response = NextResponse.redirect(successDest);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(errorUrl);
  }

  return response;
}
