import { Router, type IRouter } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { buildMemoryContext, saveMemory, getMemory } from "../lib/memory";
import { requireAuth, getAuthUser } from "../middlewares/auth";
import { checkBudget, checkDailyQuota, trackUsage } from "../lib/cost";

const router: IRouter = Router();

const GPT_INPUT_COST_PER_1K = 0.002;
const GPT_OUTPUT_COST_PER_1K = 0.008;

function parseId(val: unknown): number | null {
  const n = parseInt(String(val), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ownerFilter(userId: string) {
  return or(eq(projectsTable.userId, userId), isNull(projectsTable.userId));
}

router.get("/advisor/:projectId/status", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const projectId = parseId(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), ownerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const entries = await getMemory(projectId);
  const loaded = {
    ceo_report: entries.some((e) => e.type === "ceo_report"),
    marketing_plan: entries.some((e) => e.type === "marketing_plan"),
    sales_playbook: entries.some((e) => e.type === "sales_playbook"),
    chat_history: entries.filter((e) => e.type === "chat_history").length,
  };

  res.json({ projectId, projectName: project.name, loaded });
});

router.get("/advisor/:projectId/history", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const projectId = parseId(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), ownerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const entries = await getMemory(projectId, "chat_history");
  res.json(
    entries.slice(0, 50).map((e) => ({
      id: e.id,
      content: e.content,
      createdAt: e.createdAt.toISOString(),
    }))
  );
});

router.post("/advisor/:projectId/ask", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const projectId = parseId(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) { res.status(400).json({ error: "question is required" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), ownerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // Budget & quota guard (must be before SSE headers)
  const [budgetRes, quotaRes] = await Promise.all([
    checkBudget(userId),
    checkDailyQuota(userId),
  ]);
  if (!budgetRes.allowed) {
    res.status(402).json({
      error: `Ngân sách tháng đã hết: đã dùng $${budgetRes.spent.toFixed(4)} / $${budgetRes.limit.toFixed(2)}. Vào /cost để xem chi tiết.`,
    });
    return;
  }
  if (!quotaRes.allowed) {
    res.status(429).json({
      error: `Quota token hàng ngày đã hết: ${quotaRes.used.toLocaleString()} / ${quotaRes.limit.toLocaleString()} tokens. Thử lại vào ngày mai.`,
    });
    return;
  }

  const memoryContext = await buildMemoryContext(projectId, question);

  const systemPrompt = `Bạn là Advisor Agent — cố vấn kinh doanh tổng hợp cho dự án "${project.name}".

Bạn có quyền truy cập toàn bộ dữ liệu của dự án, bao gồm:
- Báo cáo CEO (phân tích thị trường, SWOT, đối thủ cạnh tranh)
- Kế hoạch Marketing (brand identity, customer persona, chiến lược kênh)
- Sales Playbook (quy trình bán hàng, kịch bản, xử lý từ chối)
- Lịch sử chat với người dùng

${memoryContext ? `Dữ liệu dự án:\n\n${memoryContext}` : `Lưu ý: Dự án "${project.name}" chưa có dữ liệu từ các AI agent. Hãy đề xuất người dùng chạy phân tích (Auto Orchestrate) trước.`}

Nguyên tắc trả lời:
- Trả lời TRỰC TIẾP từ dữ liệu có sẵn, không đoán mò
- Nếu câu hỏi có câu trả lời rõ ràng trong dữ liệu, trích dẫn cụ thể
- Nếu không có đủ dữ liệu, giải thích rõ và gợi ý cách tìm thêm thông tin
- Ngôn ngữ: tiếng Việt, ngắn gọn, thực tế
- Dùng markdown khi cần (bullet, bold, bảng)`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let fullResponse = "";
  let advInputTokens = 0;
  let advOutputTokens = 0;

  try {
    const stream = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
      if (chunk.usage) {
        advInputTokens = chunk.usage.prompt_tokens ?? 0;
        advOutputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    const snapshot = `[Câu hỏi]: ${question}\n[Advisor]: ${fullResponse}`;
    await saveMemory(projectId, "chat_history", snapshot).catch(() => {});

    const advTotalTokens = advInputTokens + advOutputTokens;
    if (advTotalTokens > 0) {
      const advCost =
        (advInputTokens / 1000) * GPT_INPUT_COST_PER_1K +
        (advOutputTokens / 1000) * GPT_OUTPUT_COST_PER_1K;
      await trackUsage(userId, advTotalTokens, advCost, "chat").catch(() => {});
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err), done: true })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
