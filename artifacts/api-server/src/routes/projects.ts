import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, agentTasksTable } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
  RunAllAgentsParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { emitJobEvent } from "../lib/queue";

const router: IRouter = Router();

function formatProject(p: typeof projectsTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    executionPlan: p.executionPlan ? (JSON.parse(p.executionPlan) as unknown) : null,
  };
}

function formatTask(t: typeof agentTasksTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    queuedAt: t.queuedAt ? t.queuedAt.toISOString() : null,
  };
}

// GET /api/healthz
router.get("/healthz", (_req, res): void => {
  res.json({ status: "ok" });
});

// GET /api/projects
router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);
  res.json(projects.map(formatProject));
});

// POST /api/projects — creates project + CEO task (pending, not yet queued)
router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({
      name: parsed.data.name,
      businessIdea: parsed.data.businessIdea,
      industry: parsed.data.industry ?? null,
      targetMarket: parsed.data.targetMarket ?? null,
      status: "draft",
      completionPercent: 0,
    })
    .returning();

  await db.insert(agentTasksTable).values({
    projectId: project.id,
    agentType: "ceo",
    agentName: "AI CEO",
    status: "pending",
  });

  res.status(201).json(formatProject(project));
});

// GET /api/projects/:id
router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
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

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, params.data.id))
    .orderBy(agentTasksTable.id);

  res.json({ ...formatProject(project), tasks: tasks.map(formatTask) });
});

// DELETE /api/projects/:id
router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

// POST /api/projects/:id/run-all
// Non-blocking: enqueues CEO into job queue and returns immediately.
// Worker picks up CEO, CEO orchestrates remaining agents into the queue.
router.post("/projects/:id/run-all", async (req, res): Promise<void> => {
  const params = RunAllAgentsParams.safeParse(req.params);
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

  // Reset project state
  await db.delete(agentTasksTable).where(eq(agentTasksTable.projectId, params.data.id));
  await db
    .update(projectsTable)
    .set({ status: "running", completionPercent: 0, executionPlan: null })
    .where(eq(projectsTable.id, params.data.id));

  // Enqueue CEO task — worker will pick it up, run it, then orchestrate rest
  const [ceoTask] = await db
    .insert(agentTasksTable)
    .values({
      projectId: params.data.id,
      agentType: "ceo",
      agentName: "AI CEO",
      status: "pending",
      queuedAt: new Date(),
    })
    .returning();

  emitJobEvent({
    type: "job_queued",
    taskId: ceoTask.id,
    agentType: "ceo",
    agentName: "AI CEO",
    projectId: project.id,
    projectName: project.name,
  });

  logger.info({ projectId: project.id, taskId: ceoTask.id }, "CEO job enqueued via run-all");

  // Return immediately — non-blocking
  res.status(202).json({
    projectId: params.data.id,
    taskId: ceoTask.id,
    message: "CEO job enqueued. Worker will process automatically.",
  });
});

export default router;
