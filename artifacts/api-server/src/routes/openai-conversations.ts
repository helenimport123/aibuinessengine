import { Router, type IRouter } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import {
  CreateOpenaiConversationBody,
  GetOpenaiConversationParams,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  SendOpenaiMessageParams,
  SendOpenaiMessageBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth, getAuthUser } from "../middlewares/auth";
import { checkBudget, checkDailyQuota, trackUsage } from "../lib/cost";

const router: IRouter = Router();

const GPT_INPUT_COST_PER_1K = 0.002;
const GPT_OUTPUT_COST_PER_1K = 0.008;

function formatConv(c: typeof conversations.$inferSelect) {
  return { ...c, createdAt: c.createdAt.toISOString() };
}

function formatMsg(m: typeof messages.$inferSelect) {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

function ownerFilter(userId: string) {
  return and(
    isNull(conversations.projectId),
    or(eq(conversations.userId, userId), isNull(conversations.userId))
  );
}

// GET /openai/conversations
router.get("/openai/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const convs = await db
    .select()
    .from(conversations)
    .where(ownerFilter(userId))
    .orderBy(conversations.createdAt);
  res.json(convs.map(formatConv));
});

// POST /openai/conversations
router.post("/openai/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [conv] = await db
    .insert(conversations)
    .values({ userId, title: parsed.data.title })
    .returning();

  res.status(201).json(formatConv(conv));
});

// GET /openai/conversations/:id
router.get("/openai/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = GetOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.data.id),
        or(eq(conversations.userId, userId), isNull(conversations.userId))
      )
    );

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json({ ...formatConv(conv), messages: msgs.map(formatMsg) });
});

// DELETE /openai/conversations/:id
router.delete("/openai/conversations/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = DeleteOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, params.data.id),
        or(eq(conversations.userId, userId), isNull(conversations.userId))
      )
    )
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.sendStatus(204);
});

// GET /openai/conversations/:id/messages
router.get("/openai/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = ListOpenaiMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.data.id),
        or(eq(conversations.userId, userId), isNull(conversations.userId))
      )
    );

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json(msgs.map(formatMsg));
});

// POST /openai/conversations/:id/messages  — SSE streaming
router.post("/openai/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const params = SendOpenaiMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SendOpenaiMessageBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.data.id),
        or(eq(conversations.userId, userId), isNull(conversations.userId))
      )
    );

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

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

  await db.insert(messages).values({
    conversationId: params.data.id,
    role: "user",
    content: body.data.content,
  });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let fullResponse = "";
  let oaiInputTokens = 0;
  let oaiOutputTokens = 0;

  try {
    const stream = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "Bạn là AI Business Advisor — chuyên gia tư vấn kinh doanh cho doanh nhân Việt Nam. Bạn có kiến thức sâu rộng về thị trường Việt Nam, pháp luật kinh doanh, marketing số, và khởi nghiệp. Trả lời ngắn gọn, thực tế, dễ áp dụng. Ngôn ngữ chính: tiếng Việt.",
        },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
      if (chunk.usage) {
        oaiInputTokens = chunk.usage.prompt_tokens ?? 0;
        oaiOutputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    await db.insert(messages).values({
      conversationId: params.data.id,
      role: "assistant",
      content: fullResponse,
    });

    const oaiTotalTokens = oaiInputTokens + oaiOutputTokens;
    if (oaiTotalTokens > 0) {
      const oaiCost =
        (oaiInputTokens / 1000) * GPT_INPUT_COST_PER_1K +
        (oaiOutputTokens / 1000) * GPT_OUTPUT_COST_PER_1K;
      await trackUsage(userId, oaiTotalTokens, oaiCost, "chat").catch(() => {});
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err), done: true })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
