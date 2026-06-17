import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import projectsRouter from "./projects";
import agentTasksRouter from "./agent-tasks";
import openaiConversationsRouter from "./openai-conversations";
import chatRouter from "./chat";
import jobsRouter from "./jobs";
import advisorRouter from "./advisor";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(agentTasksRouter);
router.use(openaiConversationsRouter);
router.use(chatRouter);
router.use(jobsRouter);
router.use(advisorRouter);

export default router;
