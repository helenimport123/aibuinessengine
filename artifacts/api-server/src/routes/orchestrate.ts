import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, agentTasksTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { emitJobEvent } from "../lib/queue";
import { enqueueAgentJob } from "../lib/bullmq-queue";
import { requireAuth, getAuthUser } from "../middlewares/auth";

const AGENT_LABELS: Record<string, string> = {
  ceo: "AI CEO",
  marketing: "AI Marketing",
  sales: "AI Sales",
  hr: "AI HR",
  accountant: "AI Kế Toán",
  legal: "AI Pháp Lý",
  cskh: "AI CSKH",
};

const router: IRouter = Router();

const ALL_SUBORDINATE_AGENTS = ["marketing", "sales", "hr", "accountant", "legal", "cskh"] as const;

// POST /api/orchestrate — create project + all tasks + auto-queue CEO
router.post("/orchestrate", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const { businessIdea, industry, targetMarket } = req.body ?? {};

  if (typeof businessIdea !== "string" || businessIdea.trim().length < 10) {
    res.status(400).json({ error: "businessIdea must be at least 10 characters" });
    return;
  }

  // Derive a project name from the business idea (first 60 chars)
  const name = businessIdea.length > 60 ? businessIdea.slice(0, 60) + "…" : businessIdea;

  // Build the full execution plan for all 6 subordinate agents
  const fullPlan = ALL_SUBORDINATE_AGENTS.map((agent) => ({
    agent,
    reason: "Orchestrator mode — all agents run by default",
  }));

  // Create project with pre-set execution plan
  const [project] = await db
    .insert(projectsTable)
    .values({
      userId,
      name,
      businessIdea,
      industry: industry ?? null,
      targetMarket: targetMarket ?? null,
      status: "running",
      completionPercent: 0,
      executionPlan: JSON.stringify(fullPlan),
    })
    .returning();

  // Create ALL tasks upfront (CEO + 6 subordinates) so UI can show them immediately
  const now = new Date();

  const [ceoTask] = await db
    .insert(agentTasksTable)
    .values({
      projectId: project.id,
      agentType: "ceo",
      agentName: "AI CEO",
      status: "pending",
      queuedAt: now,
    })
    .returning();

  // Create all subordinate tasks as "pending" so they appear in the UI from the start
  await db.insert(agentTasksTable).values(
    ALL_SUBORDINATE_AGENTS.map((agent) => ({
      projectId: project.id,
      agentType: agent,
      agentName: AGENT_LABELS[agent] ?? agent,
      status: "pending",
      queuedAt: null,
    }))
  );

  // Queue CEO to BullMQ — worker will enqueue subordinates after CEO finishes
  await enqueueAgentJob({
    taskId: ceoTask.id,
    projectId: project.id,
    agentType: "ceo",
    agentName: "AI CEO",
    userId,
  });

  emitJobEvent({
    type: "job_queued",
    taskId: ceoTask.id,
    agentType: "ceo",
    agentName: "AI CEO",
    projectId: project.id,
    projectName: project.name,
  });

  logger.info({ projectId: project.id, taskId: ceoTask.id }, "Orchestrator: CEO job enqueued, all tasks pre-created");

  res.status(201).json({
    projectId: project.id,
    taskId: ceoTask.id,
    message: "Orchestrator started. CEO agent is running, subordinates will auto-start after CEO completes.",
  });
});

// GET /api/orchestrate/:id/progress — project + all task statuses for live progress UI
router.get("/orchestrate/:id/progress", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, id))
    .orderBy(agentTasksTable.id);

  const agentOrder = ["ceo", "marketing", "sales", "hr", "accountant", "legal", "cskh"];
  const sortedTasks = [...tasks].sort((a, b) => {
    const ai = agentOrder.indexOf(a.agentType);
    const bi = agentOrder.indexOf(b.agentType);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  res.json({
    projectId: project.id,
    name: project.name,
    businessIdea: project.businessIdea,
    status: project.status,
    completionPercent: project.completionPercent,
    executiveSummary: project.executiveSummary ?? null,
    tasks: sortedTasks.map((t) => ({
      id: t.id,
      agentType: t.agentType,
      agentName: t.agentName,
      status: t.status,
      output: t.output ?? null,
      errorMessage: t.errorMessage ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
  });
});

export default router;
