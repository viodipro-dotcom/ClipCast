import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RendererErrorBoundary from "./components/RendererErrorBoundary";
import { NetworkStatusProvider } from "./lib/networkStatus";
import { attachRendererErrorHandlers } from "./lib/rendererErrorLogger";
import "./i18n";

if (typeof window !== "undefined") {
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
