import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  businessIdea: text("business_idea").notNull(),
  industry: text("industry"),
  targetMarket: text("target_market"),
  status: text("status").notNull().default("draft"),
  completionPercent: integer("completion_percent").notNull().default(0),
  executionPlan: text("execution_plan"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  completionPercent: true,
  status: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
