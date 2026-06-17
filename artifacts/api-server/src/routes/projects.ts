import { Router, type IRouter } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, projectsTable, agentTasksTable } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
  RunAllAgentsParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { emitJobEvent } from "../lib/queue";
import { requireAuth, getAuthUser } from "../middlewares/auth";

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

// Ownership filter: user owns the project OR it's legacy (null userId)
function ownerFilter(userId: string) {
  return or(eq(projectsTable.userId, userId), isNull(projectsTable.userId));
}

// GET /api/healthz
router.get("/healthz", (_req, res): void => {
  res.json({ status: "ok" });
});

// GET /api/projects
router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const projects = await db
    .select()
    .from(projectsTable)
    .where(ownerFilter(userId))
    .orderBy(projectsTable.createdAt);
  res.json(projects.map(formatProject));
});

// POST /api/projects — creates project + CEO task (pending, not yet queued)
router.post("/projects", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db
    .insert(projectsTable)
    .values({
      userId,
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
router.get("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), ownerFilter(userId)));

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
router.delete("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), ownerFilter(userId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

// POST /api/projects/:id/run-all
router.post("/projects/:id/run-all", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = RunAllAgentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), ownerFilter(userId)));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await db.delete(agentTasksTable).where(eq(agentTasksTable.projectId, params.data.id));
  await db
    .update(projectsTable)
    .set({ status: "running", completionPercent: 0, executionPlan: null })
    .where(eq(projectsTable.id, params.data.id));

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

  res.status(202).json({
    projectId: params.data.id,
    taskId: ceoTask.id,
    message: "CEO job enqueued. Worker will process automatically.",
  });
});

export default router;
