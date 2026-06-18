import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const projectsTable = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    businessIdea: text("business_idea").notNull(),
    industry: text("industry"),
    targetMarket: text("target_market"),
    status: text("status").notNull().default("draft"),
    completionPercent: integer("completion_percent").notNull().default(0),
    executionPlan: text("execution_plan"),
    executiveSummary: text("executive_summary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_projects_user_id").on(table.userId)]
);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  completionPercent: true,
  status: true,
  userId: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
