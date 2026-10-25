import Fastify from "fastify";
import formbody from "@fastify/formbody";

import { config } from "./config.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerOAuthRoutes } from "./routes/oauth.js";
import { SupabasePersistence } from "./lib/supabase-persistence.js";
import { InMemoryStore } from "./store.js";
import { createRecoveryRuntime, type RecoveryRuntime } from "./lib/recovery/runtime.js";

export function buildApp(options: {recovery?:RecoveryRuntime|null} = {}) {
  // Recovery boot includes verified database sessions and a bounded GOP drain.
  // Keep readiness closed during boot without the legacy 10s hook timeout
  // repeatedly restarting an otherwise healthy recovery composition.
  const app = Fastify({ logger: true, pluginTimeout: process.env.RECOVERY_V1_ENABLED === 'true' ? 120_000 : 10_000 });
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
  app.decorate("recovery", options.recovery === undefined ? createRecoveryRuntime(store) : options.recovery);
  app.register(formbody);
  app.addHook("onReady", async () => {
    await store.loadExternalState();
    await app.recovery?.start();
  });
  app.addHook("onClose",async()=>{await app.recovery?.stop();});

  app.get("/health", async () => ({
    status: "ok",
    appEnv: config.env,
    fiscalProductionBlocked: !config.fiscalProductionEnabled,
    timestamp: new Date().toISOString()
  }));

  app.get("/ready", async (_request,reply) => {
    const ready=!app.recovery||app.recovery.ready;
    return reply.code(ready?200:503).send({
    status: ready ? "ready" : "recovery_unavailable",
    persistence:
      config.supabaseUrl && config.supabaseServiceRoleKey ? "supabase" : "local",
    fiscalProductionBlocked: !config.fiscalProductionEnabled,
    timestamp: new Date().toISOString(),
    recovery:app.recovery?{enabled:true,ready:app.recovery.ready}: {enabled:false},
  });});

  app.register(registerOAuthRoutes);
  app.register(registerDocumentRoutes);
  app.register(registerAdminRoutes);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    store: InMemoryStore;
    recovery: RecoveryRuntime | null;
  }
}
