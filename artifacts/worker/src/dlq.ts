import { db, deadLetterQueueTable } from "@workspace/db";
import { logger } from "./logger";

export interface DLQEntry {
  taskId: number | null;
  agentType: string;
  agentName: string;
  projectId: number;
  failureReason: string;
  attemptCount: number;
  jobData?: unknown;
}

export async function moveToDLQ(entry: DLQEntry): Promise<void> {
  try {
    await db.insert(deadLetterQueueTable).values({
      taskId: entry.taskId,
      agentType: entry.agentType,
      agentName: entry.agentName,
      projectId: entry.projectId,
      failureReason: entry.failureReason,
      attemptCount: entry.attemptCount,
      jobData: entry.jobData as any,
      lastAttemptAt: new Date(),
    });
    logger.warn(
      { taskId: entry.taskId, agentType: entry.agentType, failureReason: entry.failureReason },
      "Job moved to Dead Letter Queue"
    );
  } catch (err) {
    logger.error({ err, entry }, "Failed to write to DLQ");
  }
}
