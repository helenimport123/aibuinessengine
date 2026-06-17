import app from "./app";
import { logger } from "./lib/logger";
import { worker } from "./lib/worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start background job worker
  worker.start().catch((err) => {
    logger.error({ err }, "Failed to start job worker");
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — stopping worker");
  worker.stop();
});

process.on("SIGINT", () => {
  logger.info("SIGINT received — stopping worker");
  worker.stop();
});
