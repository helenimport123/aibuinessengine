import { createWorker, WORKER_ID, heartbeat } from "./processor";
import { logger } from "./logger";

const worker = createWorker();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal, workerId: WORKER_ID }, "Shutting down worker");
  heartbeat.stop();
  await worker.close();
  logger.info("Worker shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection in worker");
});

logger.info({ workerId: WORKER_ID }, "Worker process started");
