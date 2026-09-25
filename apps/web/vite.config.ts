import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  if (process.env.VERCEL === "1") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    const apiUrl = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL;
    let validApiUrl = false;
    try {
      const parsed = new URL(apiUrl ?? "");
      validApiUrl = parsed.protocol === "https:" && !parsed.username && !parsed.password
        && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    } catch { /* Report configuration errors without exposing the URL. */ }
    if (!validApiUrl) throw new Error("Set VITE_API_BASE_URL to the deployed HTTPS TAKE API before building on Vercel.");
  }
  return { plugins: [react()] };
});
