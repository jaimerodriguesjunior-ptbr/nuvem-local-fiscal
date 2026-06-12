import { buildApp } from "./app.js";
import { config } from "./config.js";

async function start() {
  const app = buildApp();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: config.port
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
