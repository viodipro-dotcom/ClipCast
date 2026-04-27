import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use relative asset paths so file:// loads in packaged app.
  base: "./",
  plugins: [react()],
});
