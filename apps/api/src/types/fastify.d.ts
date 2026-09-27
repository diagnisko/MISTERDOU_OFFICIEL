import type { ActiveSession } from "../lib/sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: ActiveSession;
  }
}