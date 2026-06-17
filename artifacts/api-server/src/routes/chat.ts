import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, conversations, messages, projectsTable, knowledgeBaseTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { buildProjectContext } from "../lib/rag";

const router: IRouter = Router();

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

// GET /chat/projects/:id/conversations
router.get("/chat/projects/:id/conversations", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const convs = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, id))
    .orderBy(desc(conversations.createdAt));

  res.json(convs.map(formatConv));
});

// POST /chat/projects/:id/conversations
router.post("/chat/projects/:id/conversations", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const title = typeof req.body?.title === "string" && req.body.title.trim()
    ? req.body.title.trim()
    : `Chat về ${project.name}`;

  const [conv] = await db
    .insert(conversations)
    .values({ projectId: id, title })
    .returning();

  res.status(201).json(formatConv(conv));
});

// GET /chat/conversations/:convId
router.get("/chat/conversations/:convId", async (req, res): Promise<void> => {
  const convId = parseId(req.params.convId);
  if (!convId) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(messages.createdAt);

  res.json({ ...formatConv(conv), messages: msgs.map(formatMsg) });
});

// DELETE /chat/conversations/:convId
router.delete("/chat/conversations/:convId", async (req, res): Promise<void> => {
  const convId = parseId(req.params.convId);
  if (!convId) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const [deleted] = await db.delete(conversations).where(eq(conversations.id, convId)).returning();
  if (!deleted) { res.status(404).json({ error: "Conversation not found" }); return; }

  res.sendStatus(204);
});

// POST /chat/conversations/:convId/messages  — SSE with RAG
router.post("/chat/conversations/:convId/messages", async (req, res): Promise<void> => {
  const convId = parseId(req.params.convId);
  if (!convId) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) { res.status(400).json({ error: "content is required" }); return; }

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  // Build RAG system prompt
  let systemPrompt =
    "Bạn là AI Business Advisor — chuyên gia tư vấn kinh doanh cho doanh nhân Việt Nam. " +
    "Trả lời ngắn gọn, thực tế, dễ áp dụng. Ngôn ngữ chính: tiếng Việt.";

  if (conv.projectId) {
    const context = await buildProjectContext(conv.projectId);
    if (context) {
      systemPrompt =
        `Bạn là AI Business Advisor cho dự án này. Bạn có đầy đủ thông tin về dự án và có thể trả lời mọi câu hỏi dựa trên dữ liệu thực tế.\n\n` +
        `${context}\n\n` +
        `Hãy trả lời câu hỏi của người dùng dựa trên thông tin dự án ở trên. ` +
        `Nếu không tìm thấy thông tin cụ thể, hãy suy luận từ context hiện có. ` +
        `Trả lời bằng tiếng Việt, ngắn gọn và thực tế.`;
    }
  }

  // Save user message
  await db.insert(messages).values({ conversationId: convId, role: "user", content });

  // Fetch last 20 messages for context
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
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }

    await db.insert(messages).values({
      conversationId: convId,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err), done: true })}\n\n`);
  } finally {
    res.end();
  }
});

// GET /chat/projects/:id/knowledge
router.get("/chat/projects/:id/knowledge", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid project id" }); return; }

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

export default router;
