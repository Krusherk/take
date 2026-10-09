import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { AutoFinalizer } from "../services/autoFinalizer.js";

const SECRET = "cron-test-secret-value";
let app: FastifyInstance;

beforeAll(async () => {
  process.env.CRON_SECRET = SECRET;
  // The route is under test, not the job: never touch the shared test database's campaigns.
  vi.spyOn(AutoFinalizer.prototype, "run").mockResolvedValue({ serverWallet: null, indexer: { caughtUp: true }, steps: [], durationMs: 1 });
  const { buildApp } = await import("../app.js");
  app = await buildApp();
});
afterAll(async () => { vi.restoreAllMocks(); await app?.close(); });

const auth = { authorization: `Bearer ${SECRET}` };

describe("POST /internal/cron/finalize", () => {
  it("accepts a form-encoded body, as cron-job.org sends it, on the first request", async () => {
    const response = await app.inject({ method: "POST", url: "/internal/cron/finalize",
      headers: { ...auth, "content-type": "application/x-www-form-urlencoded" }, payload: "a=b" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("ok");
  });

  it("accepts an empty JSON body and an unknown content type", async () => {
    for (const contentType of ["application/json", "text/plain; charset=utf-8", "application/xml"]) {
      const response = await app.inject({ method: "POST", url: "/internal/cron/finalize",
        headers: { ...auth, "content-type": contentType }, payload: "" });
      expect(response.statusCode, contentType).toBe(200);
    }
  });

  it("still refuses a missing or wrong token, whatever the body", async () => {
    const missing = await app.inject({ method: "POST", url: "/internal/cron/finalize",
      headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "a=b" });
    expect(missing.statusCode).toBe(401);
    const wrong = await app.inject({ method: "POST", url: "/internal/cron/finalize", headers: { authorization: "Bearer nope" } });
    expect(wrong.statusCode).toBe(401);
  });

  it("answers 200 with the failure in the body when the run itself throws", async () => {
    vi.spyOn(AutoFinalizer.prototype, "run").mockRejectedValueOnce(new TypeError("boom"));
    const response = await app.inject({ method: "POST", url: "/internal/cron/finalize", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, errors: [{ stage: "run", code: "TypeError" }] });
  });

  it("reports stage errors without failing the request", async () => {
    vi.spyOn(AutoFinalizer.prototype, "run").mockResolvedValueOnce({
      serverWallet: null, indexer: { error: "HttpRequestError" }, steps: [], durationMs: 1
    });
    const response = await app.inject({ method: "GET", url: "/internal/cron/finalize", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, errors: [{ stage: "indexer", code: "HttpRequestError" }] });
  });
});

describe("framework client errors", () => {
  it("keep their 4xx status instead of becoming a 500", async () => {
    const response = await app.inject({ method: "POST", url: "/me/notifications/read",
      headers: { "content-type": "application/xml" }, payload: "<x/>" });
    expect(response.statusCode).toBe(415);
  });
});
