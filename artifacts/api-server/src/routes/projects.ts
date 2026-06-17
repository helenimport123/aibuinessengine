import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, agentTasksTable } from "@workspace/db";
import {
  CreateProjectBody,
  GetProjectParams,
  DeleteProjectParams,
  GetProjectSummaryParams,
  RunAllAgentsParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { runAgentForProject } from "../lib/agents";

const router: IRouter = Router();

const AGENT_TYPES = [
  { type: "ceo", name: "AI CEO" },
  { type: "marketing", name: "AI Marketing" },
  { type: "sales", name: "AI Sales" },
  { type: "cskh", name: "AI CSKH" },
  { type: "hr", name: "AI HR" },
  { type: "accountant", name: "AI Accountant" },
  { type: "legal", name: "AI Legal" },
];

function formatProject(p: typeof projectsTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
  };
}

function formatTask(t: typeof agentTasksTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
  };
}

// GET /projects
router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .orderBy(projectsTable.createdAt);
  res.json(projects.map(formatProject));
});

// POST /projects
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

  // Create pending tasks for all 7 agents
  await db.insert(agentTasksTable).values(
    AGENT_TYPES.map((a) => ({
      projectId: project.id,
      agentType: a.type,
      agentName: a.name,
      status: "pending",
    }))
  );

  res.status(201).json(formatProject(project));
});

// GET /projects/:id
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

// DELETE /projects/:id
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

// GET /projects/:id/summary
router.get("/projects/:id/summary", async (req, res): Promise<void> => {
  const params = GetProjectSummaryParams.safeParse(req.params);
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
    .where(eq(agentTasksTable.projectId, params.data.id));

  const summary = {
    projectId: project.id,
    projectName: project.name,
    businessIdea: project.businessIdea,
    totalAgents: tasks.length,
    completedAgents: tasks.filter((t) => t.status === "completed").length,
    runningAgents: tasks.filter((t) => t.status === "running").length,
    pendingAgents: tasks.filter((t) => t.status === "pending").length,
    failedAgents: tasks.filter((t) => t.status === "failed").length,
    completionPercent: project.completionPercent,
    status: project.status,
    tasks: tasks.map(formatTask),
  };

  res.json(summary);
});

// POST /projects/:id/run-all
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

  // Mark project as running
  await db
    .update(projectsTable)
    .set({ status: "running" })
    .where(eq(projectsTable.id, params.data.id));

  // Reset all pending tasks
  await db
    .update(agentTasksTable)
    .set({ status: "pending", output: null, errorMessage: null, completedAt: null })
    .where(eq(agentTasksTable.projectId, params.data.id));

  // Fire off all agents in background (non-blocking)
  const agentTypes = AGENT_TYPES.map((a) => a.type);
  for (const agentType of agentTypes) {
    runAgentForProject(params.data.id, agentType, project).catch((err) => {
      logger.error({ err, agentType, projectId: params.data.id }, "Background agent failed");
    });
  }

  res.json({
    projectId: params.data.id,
    agentsTriggered: agentTypes,
    message: "All agents triggered. Running in background.",
  });
});

export default router;
