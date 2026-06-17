import { pgTable, serial, integer, timestamp, text, doublePrecision } from "drizzle-orm/pg-core";
import { agentTasksTable } from "./agent_tasks";

export const agentRunsTable = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => agentTasksTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("running"),
  tokens: integer("tokens"),
  cost: doublePrecision("cost"),
  workerId: text("worker_id"),
});

export type AgentRun = typeof agentRunsTable.$inferSelect;
