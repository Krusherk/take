import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Production API used when a Vercel preview build has no VITE_API_BASE_URL of its own.
const PRODUCTION_API_URL = "https://take-api-sand.vercel.app";

function isDeployableApiUrl(value: string | undefined) {
  try {
    const parsed = new URL(value ?? "");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const define: Record<string, string> = {};
  if (process.env.VERCEL === "1") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    const apiUrl = process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL;
    if (!isDeployableApiUrl(apiUrl)) {
      // Production must name its API explicitly. Previews fall back to the production API.
      if (process.env.VERCEL_ENV === "production") {
        throw new Error("Set VITE_API_BASE_URL to the deployed HTTPS TAKE API before building on Vercel.");
      }
      define["import.meta.env.VITE_API_BASE_URL"] = JSON.stringify(PRODUCTION_API_URL);
    }
  }
  return { plugins: [react()], define };
});
