import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import agentTasksRouter from "./agent-tasks";
import openaiConversationsRouter from "./openai-conversations";
import chatRouter from "./chat";
import jobsRouter from "./jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(agentTasksRouter);
router.use(openaiConversationsRouter);
router.use(chatRouter);
router.use(jobsRouter);

export default router;
