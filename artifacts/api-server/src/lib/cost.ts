import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, usageDailyTable, budgetConfigTable } from "@workspace/db";

const DEFAULT_DAILY_TOKEN_LIMIT = parseInt(process.env.DAILY_TOKEN_LIMIT ?? "100000", 10);
const DEFAULT_MONTHLY_TOKEN_LIMIT = parseInt(process.env.MONTHLY_TOKEN_LIMIT ?? "2000000", 10);
const DEFAULT_MONTHLY_BUDGET_USD = parseFloat(process.env.MONTHLY_BUDGET_USD ?? "50.0");
const DEFAULT_RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM ?? "60", 10);

export type UsageType = "agent" | "chat";

export async function trackUsage(
  userId: string,
  tokens: number,
  cost: number,
  type: UsageType = "agent"
): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const isAgent = type === "agent" ? 1 : 0;
  const isChat = type === "chat" ? 1 : 0;

  await db
    .insert(usageDailyTable)
    .values({
      userId,
      date: today,
      totalTokens: tokens,
      totalCost: cost,
      requestCount: 1,
      agentRunCount: isAgent,
      chatMessageCount: isChat,
    })
    .onConflictDoUpdate({
      target: [usageDailyTable.userId, usageDailyTable.date],
      set: {
        totalTokens: sql`usage_daily.total_tokens + excluded.total_tokens`,
        totalCost: sql`usage_daily.total_cost + excluded.total_cost`,
        requestCount: sql`usage_daily.request_count + 1`,
        agentRunCount: sql`usage_daily.agent_run_count + excluded.agent_run_count`,
        chatMessageCount: sql`usage_daily.chat_message_count + excluded.chat_message_count`,
      },
    });
}

type NormConfig = {
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  monthlyBudgetUsd: number;
  rateLimitRpm: number;
  isAdminOverride: boolean;
};

function normalize(cfg: typeof budgetConfigTable.$inferSelect | null): NormConfig {
  return {
    dailyTokenLimit: cfg?.dailyTokenLimit ?? DEFAULT_DAILY_TOKEN_LIMIT,
    monthlyTokenLimit: cfg?.monthlyTokenLimit ?? DEFAULT_MONTHLY_TOKEN_LIMIT,
    monthlyBudgetUsd: cfg?.monthlyBudgetUsd ?? DEFAULT_MONTHLY_BUDGET_USD,
    rateLimitRpm: cfg?.rateLimitRpm ?? DEFAULT_RATE_LIMIT_RPM,
    isAdminOverride: cfg?.isAdminOverride ?? false,
  };
}

export async function getBudgetConfig(userId: string): Promise<NormConfig> {
  const [userCfg] = await db
    .select()
    .from(budgetConfigTable)
    .where(eq(budgetConfigTable.userId, userId));
  if (userCfg) return normalize(userCfg);

  const [globalCfg] = await db
    .select()
    .from(budgetConfigTable)
    .where(isNull(budgetConfigTable.userId));
  return normalize(globalCfg ?? null);
}

function monthStart(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export async function checkBudget(userId: string): Promise<{
  allowed: boolean;
  spent: number;
  limit: number;
  remaining: number;
}> {
  const cfg = await getBudgetConfig(userId);
  if (cfg.isAdminOverride || isAdmin(userId)) {
    return { allowed: true, spent: 0, limit: cfg.monthlyBudgetUsd, remaining: cfg.monthlyBudgetUsd };
  }

  const [row] = await db
    .select({ spent: sql<number>`COALESCE(SUM(total_cost), 0)::float8` })
    .from(usageDailyTable)
    .where(and(eq(usageDailyTable.userId, userId), gte(usageDailyTable.date, monthStart())));

  const spent = row?.spent ?? 0;
  const limit = cfg.monthlyBudgetUsd;
  return { allowed: spent < limit, spent, limit, remaining: Math.max(0, limit - spent) };
}

export async function checkDailyQuota(userId: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}> {
  const cfg = await getBudgetConfig(userId);
  if (cfg.isAdminOverride || isAdmin(userId)) {
    return { allowed: true, used: 0, limit: cfg.dailyTokenLimit, remaining: cfg.dailyTokenLimit };
  }

  const [row] = await db
    .select({ used: sql<number>`COALESCE(SUM(total_tokens), 0)::int` })
    .from(usageDailyTable)
    .where(and(eq(usageDailyTable.userId, userId), eq(usageDailyTable.date, todayStr())));

  const used = row?.used ?? 0;
  const limit = cfg.dailyTokenLimit;
  return { allowed: used < limit, used, limit, remaining: Math.max(0, limit - used) };
}

export async function getUsageSummary(userId: string) {
  const cfg = await getBudgetConfig(userId);
  const today = todayStr();
  const ms = monthStart();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split("T")[0];

  const history = await db
    .select()
    .from(usageDailyTable)
    .where(and(eq(usageDailyTable.userId, userId), gte(usageDailyTable.date, thirtyDaysAgo)))
    .orderBy(desc(usageDailyTable.date));

  const todayRow = history.find((r) => r.date === today);
  const monthRows = history.filter((r) => r.date >= ms);
  const monthlyTokens = monthRows.reduce((s, r) => s + r.totalTokens, 0);
  const monthlyCost = monthRows.reduce((s, r) => s + r.totalCost, 0);
  const monthlyRequests = monthRows.reduce((s, r) => s + r.requestCount, 0);

  const budgetLimit = cfg.monthlyBudgetUsd;
  const dailyLimit = cfg.dailyTokenLimit;
  const todayTokens = todayRow?.totalTokens ?? 0;

  return {
    today: {
      tokens: todayTokens,
      cost: todayRow?.totalCost ?? 0,
      requests: todayRow?.requestCount ?? 0,
      agentRuns: todayRow?.agentRunCount ?? 0,
      chatMessages: todayRow?.chatMessageCount ?? 0,
    },
    thisMonth: { tokens: monthlyTokens, cost: monthlyCost, requests: monthlyRequests },
    history: history.map((r) => ({
      date: r.date,
      tokens: r.totalTokens,
      cost: r.totalCost,
      requests: r.requestCount,
      agentRuns: r.agentRunCount,
      chatMessages: r.chatMessageCount,
    })),
    budget: {
      limit: budgetLimit,
      spent: monthlyCost,
      remaining: Math.max(0, budgetLimit - monthlyCost),
      percent: budgetLimit > 0 ? Math.min(100, (monthlyCost / budgetLimit) * 100) : 0,
    },
    dailyQuota: {
      limit: dailyLimit,
      used: todayTokens,
      remaining: Math.max(0, dailyLimit - todayTokens),
      percent: dailyLimit > 0 ? Math.min(100, (todayTokens / dailyLimit) * 100) : 0,
    },
    config: { ...cfg, isAdmin: cfg.isAdminOverride || isAdmin(userId) },
  };
}

export function isAdmin(userId: string): boolean {
  const ids = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(userId);
}
