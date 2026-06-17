import { pgTable, serial, text, integer, doublePrecision, timestamp, jsonb } from "drizzle-orm/pg-core";
import { agentTasksTable } from "./agent_tasks";

export const deadLetterQueueTable = pgTable("dead_letter_queue", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => agentTasksTable.id, { onDelete: "set null" }),
  agentType: text("agent_type").notNull(),
  agentName: text("agent_name").notNull(),
  projectId: integer("project_id").notNull(),
  failureReason: text("failure_reason").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
  jobData: jsonb("job_data"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workerHeartbeatTable = pgTable("worker_heartbeat", {
  id: serial("id").primaryKey(),
  workerId: text("worker_id").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  activeJobs: integer("active_jobs").notNull().default(0),
  completedJobs: integer("completed_jobs").notNull().default(0),
  failedJobs: integer("failed_jobs").notNull().default(0),
  processedJobs: integer("processed_jobs").notNull().default(0),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  metadata: jsonb("metadata"),
});

export type DeadLetterJob = typeof deadLetterQueueTable.$inferSelect;
export type WorkerHeartbeat = typeof workerHeartbeatTable.$inferSelect;
