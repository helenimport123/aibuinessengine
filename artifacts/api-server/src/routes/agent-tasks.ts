import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, agentTasksTable, projectsTable, agentRunsTable } from "@workspace/db";
import { RunAgentParams, GetTaskParams } from "@workspace/api-zod";
import { runAgentForProject } from "../lib/agents";
import { enqueueAgentJob } from "../lib/bullmq-queue";
import { emitJobEvent } from "../lib/queue";
import { requireAuth, getAuthUser } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function formatTask(t: typeof agentTasksTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    queuedAt: t.queuedAt ? t.queuedAt.toISOString() : null,
  };
}

function formatRun(r: typeof agentRunsTable.$inferSelect) {
  return {
    ...r,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

function ownerFilter(userId: string | null) {
  if (!userId) return isNull(projectsTable.userId);
  return or(eq(projectsTable.userId, userId), isNull(projectsTable.userId));
}

// GET /tasks
router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const tasks = await db
    .select({ task: agentTasksTable })
    .from(agentTasksTable)
    .innerJoin(projectsTable, eq(agentTasksTable.projectId, projectsTable.id))
    .where(ownerFilter(userId))
    .orderBy(agentTasksTable.createdAt);
  res.json(tasks.map((r) => formatTask(r.task)));
});

// GET /tasks/:id
router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({ task: agentTasksTable })
    .from(agentTasksTable)
    .innerJoin(projectsTable, eq(agentTasksTable.projectId, projectsTable.id))
    .where(and(eq(agentTasksTable.id, params.data.id), ownerFilter(userId)));

  if (!row) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json(formatTask(row.task));
});

// GET /tasks/:id/runs
router.get("/tasks/:id/runs", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [taskRow] = await db
    .select({ task: agentTasksTable })
    .from(agentTasksTable)
    .innerJoin(projectsTable, eq(agentTasksTable.projectId, projectsTable.id))
    .where(and(eq(agentTasksTable.id, params.data.id), ownerFilter(userId)));

  if (!taskRow) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const runs = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.taskId, params.data.id))
    .orderBy(desc(agentRunsTable.startedAt));

  res.json(runs.map(formatRun));
});

// POST /projects/:id/agents/:agentType/run  — SSE streaming (CEO runs here, sub-agents queued to BullMQ)
router.post("/projects/:id/agents/:agentType/run", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = RunAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.id, params.data.id),
        ownerFilter(userId)
      )
    );

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const allTasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, params.data.id));
  const existingTask = allTasks.find((t) => t.agentType === params.data.agentType);
  if (existingTask?.status === "running") {
    res.status(409).json({ error: "Agent đang chạy. Vui lòng đợi hoàn thành." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runAgentForProject(
      params.data.id,
      params.data.agentType,
      project,
      sendEvent as any,
      // CEO orchestration callback: enqueue sub-agent tasks to BullMQ
      async (tasks) => {
        for (const t of tasks) {
          try {
            const jobId = await enqueueAgentJob({
              taskId: t.id,
              projectId: t.projectId,
              agentType: t.agentType,
              agentName: t.agentName,
              userId: project.userId ?? null,
            });
            emitJobEvent({
              type: "job_queued",
              taskId: t.id,
              agentType: t.agentType,
              agentName: t.agentName,
              projectId: t.projectId,
              projectName: t.projectName,
            });
            logger.info({ jobId, taskId: t.id, agentType: t.agentType }, "Sub-agent enqueued to BullMQ");
          } catch (err) {
            logger.error({ err, taskId: t.id }, "Failed to enqueue sub-agent task");
          }
        }
      }
    );
  } catch (err) {
    sendEvent({ type: "error", message: String(err), done: true });
  } finally {
    res.end();
  }
});

export default router;
