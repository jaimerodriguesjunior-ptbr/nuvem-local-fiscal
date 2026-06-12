import { buildApp } from "./app.js";
import { config, validateServerConfig } from "./config.js";

async function start() {
  validateServerConfig();
  const app = buildApp();
  let closing = false;

  const closeGracefully = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "Encerrando servidor fiscal");
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error, "Falha ao encerrar servidor fiscal");
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => void closeGracefully("SIGTERM"));
  process.once("SIGINT", () => void closeGracefully("SIGINT"));

  try {
    await app.listen({
      host: config.host,
      port: config.port
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
