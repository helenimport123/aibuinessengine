import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const usageDailyTable = pgTable(
  "usage_daily",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    totalTokens: integer("total_tokens").notNull().default(0),
    totalCost: doublePrecision("total_cost").notNull().default(0),
    requestCount: integer("request_count").notNull().default(0),
    agentRunCount: integer("agent_run_count").notNull().default(0),
    chatMessageCount: integer("chat_message_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("usage_daily_user_date_idx").on(table.userId, table.date),
    index("idx_usage_daily_user_id").on(table.userId),
  ]
);

export const budgetConfigTable = pgTable("budget_config", {
  id: serial("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  dailyTokenLimit: integer("daily_token_limit").default(100000),
  monthlyTokenLimit: integer("monthly_token_limit").default(2000000),
  monthlyBudgetUsd: doublePrecision("monthly_budget_usd").default(50.0),
  rateLimitRpm: integer("rate_limit_rpm").default(60),
  isAdminOverride: boolean("is_admin_override").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UsageDaily = typeof usageDailyTable.$inferSelect;
export type BudgetConfig = typeof budgetConfigTable.$inferSelect;
