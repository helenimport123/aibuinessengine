import { Router, type IRouter } from "express";
import { eq, isNull } from "drizzle-orm";
import { db, budgetConfigTable } from "@workspace/db";
import { requireAuth, getAuthUser } from "../middlewares/auth";
import { getBudgetConfig, getUsageSummary, isAdmin } from "../lib/cost";

const router: IRouter = Router();

// GET /api/cost/summary
router.get("/cost/summary", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const summary = await getUsageSummary(userId);
  res.json(summary);
});

// GET /api/cost/config
router.get("/cost/config", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const config = await getBudgetConfig(userId);
  res.json({ ...config, isAdmin: config.isAdminOverride || isAdmin(userId) });
});

// PUT /api/cost/config
router.put("/cost/config", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const targetUserId: string | null = typeof req.body.userId === "string" ? req.body.userId : userId;

  if (targetUserId !== userId && !isAdmin(userId)) {
    res.status(403).json({ error: "Chỉ admin mới được cập nhật cấu hình của người dùng khác" });
    return;
  }

  const { dailyTokenLimit, monthlyTokenLimit, monthlyBudgetUsd, rateLimitRpm, isAdminOverride } = req.body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof dailyTokenLimit === "number" && dailyTokenLimit > 0)
    updates.dailyTokenLimit = Math.floor(dailyTokenLimit);
  if (typeof monthlyTokenLimit === "number" && monthlyTokenLimit > 0)
    updates.monthlyTokenLimit = Math.floor(monthlyTokenLimit);
  if (typeof monthlyBudgetUsd === "number" && monthlyBudgetUsd >= 0)
    updates.monthlyBudgetUsd = monthlyBudgetUsd;
  if (typeof rateLimitRpm === "number" && rateLimitRpm > 0)
    updates.rateLimitRpm = Math.floor(rateLimitRpm);
  if (typeof isAdminOverride === "boolean" && isAdmin(userId))
    updates.isAdminOverride = isAdminOverride;

  const whereClause = targetUserId
    ? eq(budgetConfigTable.userId, targetUserId)
    : isNull(budgetConfigTable.userId);

  const [existing] = await db.select().from(budgetConfigTable).where(whereClause);
  if (existing) {
    await db.update(budgetConfigTable).set(updates as any).where(eq(budgetConfigTable.id, existing.id));
  } else {
    await db.insert(budgetConfigTable).values({ userId: targetUserId, ...(updates as any) });
  }

  const config = await getBudgetConfig(userId);
  res.json({ ...config, isAdmin: config.isAdminOverride || isAdmin(userId) });
});

// GET /api/cost/export — CSV download
router.get("/cost/export", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const summary = await getUsageSummary(userId);
  const dateStr = new Date().toISOString().split("T")[0];

  const rows: (string | number)[][] = [
    ["AI Company — Báo cáo sử dụng AI", `Ngày xuất: ${dateStr}`, "", "", "", ""],
    [],
    ["=== TỔNG QUAN THÁNG NÀY ===", "", "", "", "", ""],
    ["Tokens sử dụng", "Chi phí ($)", "Số yêu cầu", "", "", ""],
    [summary.thisMonth.tokens, summary.thisMonth.cost.toFixed(4), summary.thisMonth.requests, "", "", ""],
    [],
    ["=== NGÂN SÁCH ===", "", "", "", "", ""],
    ["Giới hạn tháng ($)", "Đã dùng ($)", "Còn lại ($)", "% sử dụng", "", ""],
    [
      summary.budget.limit.toFixed(2),
      summary.budget.spent.toFixed(4),
      summary.budget.remaining.toFixed(4),
      `${summary.budget.percent.toFixed(1)}%`,
      "",
      "",
    ],
    [],
    ["=== QUOTA TOKEN NGÀY HÔM NAY ===", "", "", "", "", ""],
    ["Giới hạn ngày", "Đã dùng", "Còn lại", "% sử dụng", "", ""],
    [
      summary.dailyQuota.limit,
      summary.dailyQuota.used,
      summary.dailyQuota.remaining,
      `${summary.dailyQuota.percent.toFixed(1)}%`,
      "",
      "",
    ],
    [],
    ["=== LỊCH SỬ 30 NGÀY ===", "", "", "", "", ""],
    ["Ngày", "Tokens", "Chi phí ($)", "Yêu cầu", "Agent Runs", "Chat Messages"],
    ...summary.history.map((r) => [r.date, r.tokens, r.cost.toFixed(4), r.requests, r.agentRuns, r.chatMessages]),
  ];

  if (summary.history.length === 0) {
    rows.push(["(Chưa có dữ liệu)", "", "", "", "", ""]);
  }

  const csv = rows
    .map((row) =>
      (row as (string | number)[])
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ai-company-report-${dateStr}.csv"`
  );
  res.send("\uFEFF" + csv);
});

export default router;
