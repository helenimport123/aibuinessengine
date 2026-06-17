import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, conversations, messages, projectsTable, knowledgeBaseTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { buildProjectContext } from "../lib/rag";
import { saveMemory } from "../lib/memory";
import { requireAuth, getAuthUser } from "../middlewares/auth";
import { checkBudget, checkDailyQuota, trackUsage } from "../lib/cost";

const router: IRouter = Router();

const GPT_INPUT_COST_PER_1K = 0.002;
const GPT_OUTPUT_COST_PER_1K = 0.008;

function parseId(val: unknown): number | null {
  const n = parseInt(String(val), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatConv(c: typeof conversations.$inferSelect) {
  return { ...c, createdAt: c.createdAt.toISOString() };
}
function formatMsg(m: typeof messages.$inferSelect) {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

function projectOwnerFilter(userId: string) {
  return or(eq(projectsTable.userId, userId), isNull(projectsTable.userId));
}

function convOwnerFilter(userId: string) {
  return or(eq(conversations.userId, userId), isNull(conversations.userId));
}

// GET /chat/projects/:id/conversations
router.get("/chat/projects/:id/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), projectOwnerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const convs = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, id))
    .orderBy(desc(conversations.createdAt));

  res.json(convs.map(formatConv));
});

// POST /chat/projects/:id/conversations
router.post("/chat/projects/:id/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), projectOwnerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const title =
    typeof req.body?.title === "string" && req.body.title.trim()
      ? req.body.title.trim()
      : `Chat về ${project.name}`;

  const [conv] = await db
    .insert(conversations)
    .values({ userId, projectId: id, title })
    .returning();

  res.status(201).json(formatConv(conv));
});

// GET /chat/conversations/:convId
router.get("/chat/conversations/:convId", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const convId = parseId(req.params.convId);
  if (!convId) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, convId), convOwnerFilter(userId)));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(messages.createdAt);

  res.json({ ...formatConv(conv), messages: msgs.map(formatMsg) });
});

// DELETE /chat/conversations/:convId
router.delete("/chat/conversations/:convId", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const convId = parseId(req.params.convId);
  if (!convId) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const [deleted] = await db
    .delete(conversations)
    .where(and(eq(conversations.id, convId), convOwnerFilter(userId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Conversation not found" }); return; }

  res.sendStatus(204);
});

// POST /chat/conversations/:convId/messages  — SSE with RAG + Memory
router.post("/chat/conversations/:convId/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const convId = parseId(req.params.convId);
  if (!convId) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) { res.status(400).json({ error: "content is required" }); return; }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, convId), convOwnerFilter(userId)));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

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

  let systemPrompt =
    "Bạn là AI Business Advisor — chuyên gia tư vấn kinh doanh cho doanh nhân Việt Nam. " +
    "Trả lời ngắn gọn, thực tế, dễ áp dụng. Ngôn ngữ chính: tiếng Việt.";

  if (conv.projectId) {
    const context = await buildProjectContext(conv.projectId);
    if (context) {
      systemPrompt =
        `Bạn là AI Business Advisor cho dự án này. Bạn có đầy đủ thông tin về dự án, ` +
        `bao gồm báo cáo CEO, kế hoạch marketing, sales playbook và lịch sử chat trước đó.\n\n` +
        `${context}\n\n` +
        `Hãy trả lời câu hỏi của người dùng dựa trên thông tin dự án ở trên. ` +
        `Nếu không tìm thấy thông tin cụ thể, hãy suy luận từ context hiện có. ` +
        `Trả lời bằng tiếng Việt, ngắn gọn và thực tế.`;
    }
  }

  await db.insert(messages).values({ conversationId: convId, role: "user", content });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(messages.createdAt);

  const recentHistory = history.slice(-20);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let fullResponse = "";
  let chatInputTokens = 0;
  let chatOutputTokens = 0;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        ...recentHistory.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
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
        chatInputTokens = chunk.usage.prompt_tokens ?? 0;
        chatOutputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: fullResponse,
    });

    if (conv.projectId) {
      const chatSnapshot = `[User]: ${content}\n[Assistant]: ${fullResponse}`;
      await saveMemory(conv.projectId, "chat_history", chatSnapshot).catch(() => {});
    }

    const chatTotalTokens = chatInputTokens + chatOutputTokens;
    if (chatTotalTokens > 0) {
      const chatCost =
        (chatInputTokens / 1000) * GPT_INPUT_COST_PER_1K +
        (chatOutputTokens / 1000) * GPT_OUTPUT_COST_PER_1K;
      await trackUsage(userId, chatTotalTokens, chatCost, "chat").catch(() => {});
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err), done: true })}\n\n`);
  } finally {
    res.end();
  }
});

// GET /chat/projects/:id/knowledge
router.get("/chat/projects/:id/knowledge", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), projectOwnerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const entries = await db
    .select()
    .from(knowledgeBaseTable)
    .where(eq(knowledgeBaseTable.projectId, id))
    .orderBy(knowledgeBaseTable.updatedAt);

  res.json(
    entries.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    }))
  );
});

// GET /chat/projects/:id/memory
router.get("/chat/projects/:id/memory", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, id), projectOwnerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const { getMemory } = await import("../lib/memory");
  const type = req.query.type as import("@workspace/db").MemoryType | undefined;
  const entries = await getMemory(id, type);

  res.json(entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })));
});

export default router;
