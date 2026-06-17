import { db, workerHeartbeatTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const HEARTBEAT_INTERVAL_MS = 10_000;

export class HeartbeatReporter {
  private timer: NodeJS.Timeout | null = null;
  private workerId: string;
  private stats = { completed: 0, failed: 0, processed: 0 };

  constructor(workerId: string) {
    this.workerId = workerId;
  }

  recordCompleted(): void { this.stats.completed++; this.stats.processed++; }
  recordFailed(): void    { this.stats.failed++;    this.stats.processed++; }

  start(getActiveCount: () => number): void {
    this.upsert(getActiveCount()).catch(() => {});
    this.timer = setInterval(() => {
      this.upsert(getActiveCount()).catch((err) =>
        logger.warn({ err }, "Heartbeat write failed")
      );
    }, HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async upsert(activeJobs: number): Promise<void> {
    const existing = await db
      .select({ id: workerHeartbeatTable.id })
      .from(workerHeartbeatTable)
      .where(eq(workerHeartbeatTable.workerId, this.workerId));

    if (existing.length > 0) {
      await db
        .update(workerHeartbeatTable)
        .set({
          lastSeenAt: new Date(),
          activeJobs,
          completedJobs: this.stats.completed,
          failedJobs: this.stats.failed,
          processedJobs: this.stats.processed,
        })
        .where(eq(workerHeartbeatTable.workerId, this.workerId));
    } else {
      await db.insert(workerHeartbeatTable).values({
        workerId: this.workerId,
        lastSeenAt: new Date(),
        activeJobs,
        completedJobs: this.stats.completed,
        failedJobs: this.stats.failed,
        processedJobs: this.stats.processed,
        startedAt: new Date(),
      });
    }
  }
}
