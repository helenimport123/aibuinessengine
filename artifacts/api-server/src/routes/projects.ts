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
import { runAgentForProject } from "../lib/agents";

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
  };
}

// GET /api/healthz
router.get("/healthz", (_req, res): void => {
  res.json({ status: "ok" });
});

// GET /api/projects
router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .orderBy(projectsTable.createdAt);
  res.json(projects.map(formatProject));
});

// POST /api/projects — creates project + CEO task only (CEO will orchestrate the rest)
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
// Resets project to CEO-only state and re-runs orchestration from scratch
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

  // Delete all existing tasks and reset project state
  await db
    .delete(agentTasksTable)
    .where(eq(agentTasksTable.projectId, params.data.id));

  await db
    .update(projectsTable)
    .set({ status: "running", completionPercent: 0, executionPlan: null })
    .where(eq(projectsTable.id, params.data.id));

  // Insert fresh CEO task
  await db.insert(agentTasksTable).values({
    projectId: params.data.id,
    agentType: "ceo",
    agentName: "AI CEO",
    status: "pending",
  });

  const updatedProject = { ...project, executionPlan: null };

  // Run CEO in background — CEO will orchestrate the rest
  runAgentForProject(params.data.id, "ceo", updatedProject).catch((err) => {
    logger.error({ err, projectId: params.data.id }, "CEO orchestrator failed in background");
  });

  res.json({
    projectId: params.data.id,
    message: "CEO agent started. Execution plan will be generated automatically.",
  });
});

export default router;
