import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const agentTasksTable = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  agentType: text("agent_type").notNull(),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull().default("pending"),
  output: text("output"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  queuedAt: timestamp("queued_at"),
});

export const insertAgentTaskSchema = createInsertSchema(agentTasksTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
export type AgentTask = typeof agentTasksTable.$inferSelect;
