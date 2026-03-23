import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RendererErrorBoundary from "./components/RendererErrorBoundary";
import { NetworkStatusProvider } from "./lib/networkStatus";
import { attachRendererErrorHandlers } from "./lib/rendererErrorLogger";
import "./i18n";

// Subscribe to auth callback (deep link) as early as possible so we never miss it
const subscribeAuthCallback = (url: string) => {
  console.log("[auth] renderer received callback:", url);
  window.dispatchEvent(new CustomEvent("clipcast-deep-link", { detail: url }));
};
if (typeof window !== "undefined" && window.clipcast?.onAuthCallback) {
  window.clipcast.onAuthCallback(subscribeAuthCallback);
} else if (typeof window !== "undefined" && window.api?.onAuthDeepLink) {
  window.api.onAuthDeepLink(subscribeAuthCallback);
}

// DevTools: verify Vite env vars (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
if (typeof window !== "undefined") {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  console.log("[env] VITE_SUPABASE_URL:", url ? "set" : "missing");
  console.log("[env] VITE_SUPABASE_ANON_KEY:", anon ? "set" : "missing");
  (window as unknown as { __VITE_ENV_CHECK__?: Record<string, boolean> }).__VITE_ENV_CHECK__ = {
    VITE_SUPABASE_URL: !!url,
    VITE_SUPABASE_ANON_KEY: !!anon,
  };
  attachRendererErrorHandlers();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <NetworkStatusProvider>
        <App />
      </NetworkStatusProvider>
    </RendererErrorBoundary>
  </React.StrictMode>
);
