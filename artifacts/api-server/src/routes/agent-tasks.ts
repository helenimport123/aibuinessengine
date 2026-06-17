import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, agentTasksTable, projectsTable, agentRunsTable } from "@workspace/db";
import { RunAgentParams, GetTaskParams } from "@workspace/api-zod";
import { runAgentForProject } from "../lib/agents";

const router: IRouter = Router();

function formatTask(t: typeof agentTasksTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
  };
}

function formatRun(r: typeof agentRunsTable.$inferSelect) {
  return {
    ...r,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

// GET /tasks
router.get("/tasks", async (_req, res): Promise<void> => {
  const tasks = await db
    .select()
    .from(agentTasksTable)
    .orderBy(agentTasksTable.createdAt);
  res.json(tasks.map(formatTask));
});

// GET /tasks/:id
router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.id, params.data.id));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json(formatTask(task));
});

// GET /tasks/:id/runs — list all runs for a task
router.get("/tasks/:id/runs", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const runs = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.taskId, params.data.id))
    .orderBy(desc(agentRunsTable.startedAt));

  res.json(runs.map(formatRun));
});

// POST /projects/:id/agents/:agentType/run  — SSE streaming
router.post("/projects/:id/agents/:agentType/run", async (req, res): Promise<void> => {
  const params = RunAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runAgentForProject(params.data.id, params.data.agentType, project, sendEvent as any);
  } catch (err) {
    sendEvent({ type: "error", message: String(err), done: true });
  } finally {
    res.end();
  }
});

export default router;
