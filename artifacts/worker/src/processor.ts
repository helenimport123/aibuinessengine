import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db, agentTasksTable, projectsTable, agentRunsTable } from "@workspace/db";
import { runAgentForProject, ALL_AGENT_LABELS } from "@workspace/agents";
import { redisConnection } from "./redis";
import { logger } from "./logger";
import { moveToDLQ } from "./dlq";
import { HeartbeatReporter } from "./heartbeat";
import { enqueueAgentJob } from "./bullmq-queue";

export const AGENT_QUEUE_NAME = "agent-jobs";
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

export interface AgentJobData {
  taskId: number;
  projectId: number;
  agentType: string;
  agentName: string;
  userId: string | null;
}

const WORKER_ID = `worker-${process.pid}`;
const heartbeat = new HeartbeatReporter(WORKER_ID);
let activeCount = 0;

export function createWorker(): Worker<AgentJobData> {
  const worker = new Worker<AgentJobData>(
    AGENT_QUEUE_NAME,
    async (job: Job<AgentJobData>) => {
      const { taskId, projectId, agentType } = job.data;
      const startedAt = Date.now();
      activeCount++;

      logger.info({ jobId: job.id, taskId, agentType, workerId: WORKER_ID }, "Processing job");

      const [project] = await db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.id, projectId));

      if (!project) {
        activeCount--;
        throw new Error(`Project ${projectId} not found`);
      }

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Job timeout after ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS)
      );

      try {
        await Promise.race([
          runAgentForProject(
            projectId,
            agentType,
            project,
            undefined,
            (tasks) => {
              for (const t of tasks) {
                enqueueAgentJob({
                  taskId: t.id,
                  projectId: t.projectId,
                  agentType: t.agentType,
                  agentName: t.agentName,
                  userId: project.userId ?? null,
                }).catch((err) => logger.error({ err, taskId: t.id }, "Failed to enqueue orchestrated task"));
              }
            }
          ),
          timeoutPromise,
        ]);

        const elapsed = Date.now() - startedAt;
        heartbeat.recordCompleted();
        activeCount--;
        logger.info({ jobId: job.id, taskId, agentType, elapsedMs: elapsed }, "Job completed");
      } catch (err) {
        activeCount--;
        heartbeat.recordFailed();
        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "3", 10),
    }
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { taskId, projectId, agentType, agentName } = job.data;
    const isExhausted = (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 3);

    logger.error(
      { jobId: job.id, taskId, agentType, attempts: job.attemptsMade, exhausted: isExhausted, err },
      "Job failed"
    );

    if (isExhausted) {
      await db
        .update(agentTasksTable)
        .set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
        .where(eq(agentTasksTable.id, taskId))
        .catch(() => {});

      await moveToDLQ({
        taskId,
        agentType,
        agentName,
        projectId,
        failureReason: err.message,
        attemptCount: job.attemptsMade ?? 0,
        jobData: job.data,
      });
    }
  });

  worker.on("completed", async (job) => {
    await db
      .update(agentTasksTable)
      .set({ completedAt: new Date() })
      .where(eq(agentTasksTable.id, job.data.taskId))
      .catch(() => {});
  });

  worker.on("error", (err) => logger.error({ err }, "Worker error"));

  heartbeat.start(() => activeCount);
  logger.info(
    { workerId: WORKER_ID, concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "3", 10) },
    "BullMQ worker started"
  );

  return worker;
}

export { WORKER_ID, heartbeat };
