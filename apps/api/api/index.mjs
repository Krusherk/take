import { buildApp } from "../dist/app.js";
import { waitUntil } from "@vercel/functions";

// Reuse Fastify and its database pool within a warm invocation. Vercel calls
// this handler directly; no persistent listener or worker is started here.
let application;

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
  const app = await application;
  app.server.emit("request", request, response);
}
