import Fastify from "fastify";
import formbody from "@fastify/formbody";

import { config } from "./config.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerOAuthRoutes } from "./routes/oauth.js";
import { SupabasePersistence } from "./lib/supabase-persistence.js";
import { InMemoryStore } from "./store.js";

export function buildApp() {
  const app = Fastify({ logger: true });
  const persistence =
    config.supabaseUrl && config.supabaseServiceRoleKey
      ? new SupabasePersistence(config.supabaseUrl, config.supabaseServiceRoleKey)
      : null;
  const store = new InMemoryStore(
    config.defaultClientId,
    config.defaultClientSecret,
    config.jwtSecret,
    config.stateFile,
    persistence
  );

  app.decorate("store", store);
  app.register(formbody);
  app.addHook("onReady", async () => {
    await store.loadExternalState();
  });

  app.get("/health", async () => ({
    status: "ok",
    appEnv: config.env,
    timestamp: new Date().toISOString()
  }));

  app.register(registerOAuthRoutes);
  app.register(registerDocumentRoutes);
  app.register(registerAdminRoutes);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    store: InMemoryStore;
  }
}
