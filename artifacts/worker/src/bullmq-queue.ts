import { Queue } from "bullmq";
import { redisConnection } from "./redis";
import { logger } from "./logger";

export const AGENT_QUEUE_NAME = "agent-jobs";

export interface AgentJobData {
  taskId: number;
  projectId: number;
  agentType: string;
  agentName: string;
  userId: string | null;
}

export const agentQueue = new Queue<AgentJobData>(AGENT_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

export async function enqueueAgentJob(data: AgentJobData): Promise<string> {
  const job = await agentQueue.add(`agent:${data.agentType}:task:${data.taskId}`, data, {
    jobId: `task-${data.taskId}`,
  });
  logger.info({ jobId: job.id, taskId: data.taskId, agentType: data.agentType }, "Job enqueued");
  return job.id!;
}
