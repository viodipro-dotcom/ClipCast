/**
 * Result of parsing clipcast://auth/callback URL.
 * Params can be in query (?code=... or ?access_token=...) or hash (#access_token=...&refresh_token=...).
 */
export interface ParsedAuthCallback {
  code: string | null;
  access_token: string | null;
  refresh_token: string | null;
}

/**
 * Parse deep link URL into query/hash params with merged values.
 * Query params take precedence for `code`.
 */
export function parseParamsFromUrl(url: string): {
  query: URLSearchParams;
  hash: URLSearchParams;
  merged: Record<string, string>;
} {
  const emptyQuery = new URLSearchParams();
  const emptyHash = new URLSearchParams();
  const emptyResult = { query: emptyQuery, hash: emptyHash, merged: {} as Record<string, string> };
  try {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      const safe = url.replace(/^clipcast:\/\//, "https://clipcast.local/");
      u = new URL(safe);
    }

    const query = u.searchParams;
    const hashValue = u.hash?.startsWith("#") ? u.hash.slice(1) : "";
    const hash = new URLSearchParams(hashValue);
    const merged: Record<string, string> = {};

    const merge = (params: URLSearchParams) => {
      params.forEach((value, key) => {
        const trimmed = value.trim();
        if (trimmed) merged[key] = trimmed;
      });
    };

    merge(hash);
    merge(query);

    const queryCode = query.get("code")?.trim();
    if (queryCode) merged.code = queryCode;

    return { query, hash, merged };
  } catch {
    return emptyResult;
  }
}

/**
 * Parse deep link URL for OAuth callback. Supports both:
 * - clipcast://auth/callback?code=...&state=... (PKCE)
 * - clipcast://auth/callback#access_token=...&refresh_token=... (implicit)
 *
 * Uses URL() for parsing; if custom scheme causes issues, falls back to https://clipcast.local/.
 * Reads from query and hash and merges them (query has precedence for code).
 */
export function parseDeepLink(url: string): ParsedAuthCallback {
  const { merged } = parseParamsFromUrl(url);
  return {
    code: merged.code ?? null,
    access_token: merged.access_token ?? null,
    refresh_token: merged.refresh_token ?? null,
  };
}
