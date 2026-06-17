import IORedis from "ioredis";
import { logger } from "./logger";

const RAW_REDIS_URL = process.env.REDIS_URL;

if (!RAW_REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required for the job queue.");
}

// Handle case where REDIS_URL was set as: "redis-cli --tls -u redis://..." or similar
// Extract the actual redis:// URL from the value
function extractRedisUrl(raw: string): string {
  const match = raw.match(/(rediss?:\/\/[^\s]+)/);
  if (match) return match[1];
  return raw.trim();
}

const REDIS_URL = extractRedisUrl(RAW_REDIS_URL);

const isTls = REDIS_URL.startsWith("rediss://");

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
});

redisConnection.on("connect", () => logger.info("Redis connected"));
redisConnection.on("error", (err) => logger.error({ err }, "Redis error"));
