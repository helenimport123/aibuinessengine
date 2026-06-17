import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { jobBus, type JobEvent } from "../lib/queue";
import { worker } from "../lib/worker";

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

// GET /api/jobs/stats — live queue stats
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
  res.json({
    pending: counts.pending ?? 0,
    running: counts.running ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    workers: 1,
    workerId: worker.workerId,
    workerActive: worker.activeCount,
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "3", 10),
  });
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
