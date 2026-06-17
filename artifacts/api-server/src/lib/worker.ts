import { eq, sql } from "drizzle-orm";
import { db, agentTasksTable, projectsTable } from "@workspace/db";
import { runAgentForProject } from "./agents";
import { emitJobEvent } from "./queue";
import { logger } from "./logger";

const WORKER_ID = `worker-${process.pid}`;
const POLL_INTERVAL_MS = 600;
const POLL_IDLE_MS = 1500;
const STUCK_JOB_THRESHOLD_MINUTES = 10;

type ClaimedTask = {
  id: number;
  project_id: number;
  agent_type: string;
  agent_name: string;
  created_at: Date;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JobWorker {
  private stopped = false;
  private active = 0;
  private readonly concurrency: number;

  constructor(concurrency = 3) {
    this.concurrency = concurrency;
  }

  async start(): Promise<void> {
    logger.info({ workerId: WORKER_ID, concurrency: this.concurrency }, "Job worker starting");
    await this.recoverStuckJobs();
    this.poll().catch((err) => logger.error({ err }, "Worker poll loop crashed"));
  }

  stop(): void {
    this.stopped = true;
    logger.info({ workerId: WORKER_ID }, "Job worker stopping");
  }

  get workerId(): string {
    return WORKER_ID;
  }

  get activeCount(): number {
    return this.active;
  }

  private async recoverStuckJobs(): Promise<void> {
    try {
      const threshold = new Date(Date.now() - STUCK_JOB_THRESHOLD_MINUTES * 60 * 1000);
      const stuck = await db
        .update(agentTasksTable)
        .set({ status: "pending" })
        .where(
          sql`${agentTasksTable.status} = 'running' AND ${agentTasksTable.createdAt} < ${threshold}`
        )
        .returning({ id: agentTasksTable.id });

      if (stuck.length > 0) {
        logger.warn({ count: stuck.length }, "Reset stuck running jobs to pending");
      }
    } catch (err) {
      logger.error({ err }, "Failed to recover stuck jobs");
    }
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      if (this.active < this.concurrency) {
        const task = await this.claimNextJob();
        if (task) {
          this.active++;
          this.executeJob(task)
            .catch((err) => logger.error({ err, taskId: task.id }, "Job execution threw unexpectedly"))
            .finally(() => this.active--);
          await sleep(POLL_INTERVAL_MS);
        } else {
          await sleep(POLL_IDLE_MS);
        }
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  private async claimNextJob(): Promise<ClaimedTask | null> {
    try {
      return await db.transaction(async (tx) => {
        const result = await tx.execute<ClaimedTask>(sql`
          SELECT id, project_id, agent_type, agent_name, created_at
          FROM agent_tasks
          WHERE status = 'pending' AND queued_at IS NOT NULL
          ORDER BY queued_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

        const row = (result as any).rows?.[0] ?? null;
        if (!row) return null;

        await tx
          .update(agentTasksTable)
          .set({ status: "running" })
          .where(eq(agentTasksTable.id, row.id));

        return row;
      });
    } catch (err) {
      logger.error({ err }, "Failed to claim job");
      return null;
    }
  }

  private async executeJob(task: ClaimedTask): Promise<void> {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, task.project_id));

    if (!project) {
      logger.error({ taskId: task.id, projectId: task.project_id }, "Project not found for job, marking failed");
      await db
        .update(agentTasksTable)
        .set({ status: "failed", errorMessage: "Project not found", completedAt: new Date() })
        .where(eq(agentTasksTable.id, task.id));
      return;
    }

    emitJobEvent({
      type: "job_started",
      taskId: task.id,
      agentType: task.agent_type,
      agentName: task.agent_name,
      projectId: project.id,
      projectName: project.name,
      workerId: WORKER_ID,
    });

    logger.info({ taskId: task.id, agentType: task.agent_type, projectId: project.id, workerId: WORKER_ID }, "Worker executing job");

    try {
      await runAgentForProject(project.id, task.agent_type, project, undefined);

      // Re-fetch task to get final tokens/cost from agent_runs
      const runs = await db.execute<{ tokens: number; cost: number }>(sql`
        SELECT tokens, cost FROM agent_runs
        WHERE task_id = ${task.id}
        ORDER BY started_at DESC
        LIMIT 1
      `);
      const lastRun = (runs as any).rows?.[0] ?? (runs as any)[0];

      emitJobEvent({
        type: "job_completed",
        taskId: task.id,
        agentType: task.agent_type,
        agentName: task.agent_name,
        projectId: project.id,
        tokens: lastRun?.tokens ?? 0,
        cost: lastRun?.cost ?? 0,
      });

      logger.info({ taskId: task.id, agentType: task.agent_type }, "Worker job completed");
    } catch (err) {
      emitJobEvent({
        type: "job_failed",
        taskId: task.id,
        agentType: task.agent_type,
        agentName: task.agent_name,
        projectId: project.id,
        error: String(err),
      });
      logger.error({ err, taskId: task.id, agentType: task.agent_type }, "Worker job failed");
    }
  }
}

export const worker = new JobWorker(
  parseInt(process.env.WORKER_CONCURRENCY ?? "3", 10)
);
