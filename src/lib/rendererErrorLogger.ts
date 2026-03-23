type RendererErrorPayload = {
  type: "errorboundary" | "window.onerror" | "unhandledrejection";
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  href?: string;
  hash?: string;
};

const getLocation = () => {
  if (typeof window === "undefined") return { href: "", hash: "" };
  return { href: window.location.href || "", hash: window.location.hash || "" };
};

export function logRendererError(payload: RendererErrorPayload) {
  try {
    const location = getLocation();
    window.api?.logRendererError?.({
      ...payload,
      href: payload.href ?? location.href,
      hash: payload.hash ?? location.hash,
    });
  } catch {
    // ignore
  }
}

export function attachRendererErrorHandlers() {
  if (typeof window === "undefined") return;
  const onError = (event: ErrorEvent) => {
    logRendererError({
      type: "window.onerror",
      message: event.message || "Unknown error",
      stack: event.error?.stack,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : String(reason ?? "Unhandled rejection");
    const stack = reason instanceof Error ? reason.stack : undefined;
    logRendererError({
      type: "unhandledrejection",
      message,
      stack,
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
