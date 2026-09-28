import { buildApp } from "../dist/app.js";

// Reuse Fastify and its database pool within a warm invocation. Vercel calls
// this handler directly; no persistent listener or worker is started here.
let application;

export default async function handler(request, response) {
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
