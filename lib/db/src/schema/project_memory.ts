import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const MEMORY_TYPES = [
  "ceo_report",
  "marketing_plan",
  "sales_playbook",
  "hr_plan",
  "cskh_plan",
  "accountant_plan",
  "legal_plan",
  "chat_history",
  "executive_data",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const projectMemoryTable = pgTable("project_memory", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type").$type<MemoryType>().notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProjectMemory = typeof projectMemoryTable.$inferSelect;
