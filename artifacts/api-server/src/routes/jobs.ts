import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { jobBus, type JobEvent } from "../lib/queue";
import { agentQueue } from "../lib/bullmq-queue";

const router: IRouter = Router();

// GET /api/jobs — recent 60 tasks with project name
router.get("/jobs", async (_req, res): Promise<void> => {
  const rows = await db.execute<{
    id: number;
    project_id: number;
    project_name: string;
    agent_type: string;
    agent_name: string;
    status: string;
    created_at: string;
    completed_at: string | null;
    tokens: number | null;
    cost: number | null;
  }>(sql`
    SELECT
      t.id,
      t.project_id,
      p.name AS project_name,
      t.agent_type,
      t.agent_name,
      t.status,
      t.created_at,
      t.completed_at,
      r.tokens,
      r.cost
    FROM agent_tasks t
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN LATERAL (
      SELECT tokens, cost FROM agent_runs
      WHERE task_id = t.id
      ORDER BY started_at DESC
      LIMIT 1
    ) r ON TRUE
    ORDER BY t.created_at DESC
    LIMIT 60
  `);
  const jobs = (rows as any).rows ?? rows;
  res.json(jobs);
});

// GET /api/jobs/stats — queue stats (BullMQ + DB counts)
router.get("/jobs/stats", async (_req, res): Promise<void> => {
  const rows = await db.execute<{ status: string; count: string }>(sql`
    SELECT status, COUNT(*)::text AS count
    FROM agent_tasks
    GROUP BY status
  `);
  const counts: Record<string, number> = {};
  const raw = (rows as any).rows ?? rows;
  for (const r of raw) {
    counts[r.status] = parseInt(r.count, 10);
  }

  // BullMQ queue counts (Redis)
  let queueStats: Record<string, number> = {};
  try {
    const [waiting, active, failed, completed, delayed] = await Promise.all([
      agentQueue.getWaitingCount(),
      agentQueue.getActiveCount(),
      agentQueue.getFailedCount(),
      agentQueue.getCompletedCount(),
      agentQueue.getDelayedCount(),
    ]);
    queueStats = { waiting, active, failed, completed, delayed };
  } catch {
    queueStats = { error: 1 };
  }

  // Worker heartbeats
  const heartbeats = await db.execute<{
    worker_id: string;
    last_seen_at: string;
    active_jobs: number;
    completed_jobs: number;
    failed_jobs: number;
    processed_jobs: number;
  }>(sql`
    SELECT worker_id, last_seen_at, active_jobs, completed_jobs, failed_jobs, processed_jobs
    FROM worker_heartbeat
    ORDER BY last_seen_at DESC
    LIMIT 10
  `).catch(() => ({ rows: [] } as any));
  const workers = (heartbeats as any).rows ?? heartbeats;

  res.json({
    db: {
      pending: counts.pending ?? 0,
      running: counts.running ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    },
    queue: queueStats,
    workers,
  });
});

// GET /api/jobs/dlq — dead letter queue entries
router.get("/jobs/dlq", async (_req, res): Promise<void> => {
  const rows = await db.execute<{
    id: number;
    task_id: number | null;
    agent_type: string;
    agent_name: string;
    project_id: number;
    failure_reason: string;
    attempt_count: number;
    last_attempt_at: string;
    resolved_at: string | null;
    created_at: string;
  }>(sql`
    SELECT id, task_id, agent_type, agent_name, project_id, failure_reason,
           attempt_count, last_attempt_at, resolved_at, created_at
    FROM dead_letter_queue
    WHERE resolved_at IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `);
  res.json((rows as any).rows ?? rows);
});

// GET /api/jobs/stream — SSE real-time job events
router.get("/jobs/stream", (req, res): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (data: JobEvent | { type: "connected" } | { type: "heartbeat" }) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: "connected" });

  const listener = (event: JobEvent) => send(event);
  jobBus.on("job", listener);

  const heartbeat = setInterval(() => send({ type: "heartbeat" }), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    jobBus.off("job", listener);
  });
});

export default router;
