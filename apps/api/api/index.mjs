import { buildApp } from "../dist/app.js";
import { waitUntil } from "@vercel/functions";

// Reuse Fastify and its database pool within a warm invocation. Vercel calls
// this handler directly; no persistent listener or worker is started here.
let application;

// A read that has not answered in this long is stuck (seen: a resumed instance whose
// pooled database connection never replied, held until Vercel's 60s limit). Answer
// 503 so the web app retries at once, and rebuild the app and its pool for later
// requests on this instance. Writes (and the cron) are left alone.
const READ_DEADLINE_MS = 20_000;

function recycle(stuck) {
  if (application !== stuck) return;
  application = undefined;
  console.error("TAKE API read deadline exceeded; recycling the database pool");
  stuck?.then((app) => app.close()).catch(() => undefined);
}

export default async function handler(request, response) {
  // postgres.js idle timers cannot release sessions while an invocation is
  // suspended. Keep the invocation alive past the pool's 10-second idle timer.
  // Unlike pg, postgres.js is not supported by attachDatabasePool.
  waitUntil(new Promise((resolve) => {
    const drained = () => {
      response.off("finish", drained);
      response.off("close", drained);
      setTimeout(resolve, 11_000);
    };
    response.once("finish", drained);
    response.once("close", drained);
  }));
  application ??= buildApp().then(async (app) => {
    await app.ready();
    return app;
  }).catch((error) => {
    application = undefined;
    // Configuration diagnostics must never contain environment values.
    console.error("TAKE API startup failed", {
      name: error?.name,
      fields: error?.issues?.map((issue) => issue.path?.join("."))
    });
    throw error;
  });
  const current = application;
  const app = await current;
  if (request.method === "GET") {
    const timer = setTimeout(() => {
      if (!response.headersSent) {
        const origin = request.headers.origin;
        if (origin && origin === process.env.WEB_ORIGIN) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Vary", "Origin");
        }
        response.statusCode = 503;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Retry-After", "1");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify({ error: "TIMEOUT", message: "TAKE took too long to answer. Please try again." }));
      }
      recycle(current);
    }, READ_DEADLINE_MS);
    const done = () => clearTimeout(timer);
    response.once("finish", done);
    response.once("close", done);
  }
  app.server.emit("request", request, response);
}
