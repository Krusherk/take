// Explicit Vercel entrypoint: src/app.ts is a factory, not a running server.
// The API build prepares dist/server.js and its workspace dependencies first.
import "fastify";
import "./dist/server.js";
