import { eq } from "drizzle-orm";
import { db, agentTasksTable, projectsTable, agentRunsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import { syncTaskToKnowledgeBase } from "./rag";

type Project = typeof projectsTable.$inferSelect;

const AGENT_PROMPTS: Record<string, (p: Project) => string> = {
  ceo: (p) => `Bạn là AI CEO chuyên phân tích thị trường cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy tạo báo cáo phân tích thị trường đầy đủ bao gồm:
1. **Tổng quan thị trường** — quy mô, xu hướng, tiềm năng tăng trưởng
2. **Phân tích SWOT** — Điểm mạnh, Điểm yếu, Cơ hội, Thách thức
3. **Đối thủ cạnh tranh chính** — ít nhất 3 đối thủ, phân tích điểm mạnh/yếu
4. **Phân khúc khách hàng** — ai là khách hàng lý tưởng, insight tâm lý
5. **Chiến lược định vị thương hiệu** — USP, positioning statement
6. **Mục tiêu & KPI 12 tháng** — milestone rõ ràng theo quý
7. **Lời khuyên CEO** — 5 hành động ưu tiên cần thực hiện ngay

Viết chi tiết, chuyên nghiệp bằng tiếng Việt. Sử dụng markdown với heading, bullet points và số liệu cụ thể.`,

  marketing: (p) => `Bạn là AI Marketing Director cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng kế hoạch marketing toàn diện:
1. **Brand Identity** — tên thương hiệu gợi ý, tagline, giá trị cốt lõi
2. **Customer Persona** — 2 persona chi tiết (demographics, psychographics, pain points)
3. **Chiến lược kênh** — Facebook, TikTok, Zalo, Google, SEO/SEM
4. **Content Marketing** — chủ đề content, format, lịch đăng mẫu 1 tháng
5. **Facebook Ads** — cấu trúc chiến dịch, audience targeting, mẫu ad copy (3 biến thể)
6. **Google Ads** — từ khóa mục tiêu, cấu trúc nhóm quảng cáo, landing page
7. **Budget Marketing** — phân bổ ngân sách đề xuất theo kênh (tổng 10-50 triệu VNĐ/tháng)
8. **KPIs** — metrics theo dõi: CPC, CPL, ROAS, CAC
9. **90-Day Action Plan** — kế hoạch 90 ngày đầu tiên theo tuần

Viết chi tiết bằng tiếng Việt với ví dụ cụ thể và con số thực tế.`,

  sales: (p) => `Bạn là AI Sales Director chuyên xây dựng hệ thống bán hàng cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng sales playbook đầy đủ:
1. **ICP (Ideal Customer Profile)** — mô tả chi tiết khách hàng lý tưởng
2. **Nguồn Lead** — 5-7 kênh tìm kiếm khách hàng hiệu quả nhất
3. **Sales Funnel** — các giai đoạn từ Awareness đến Purchase đến Retention
4. **Kịch bản tiếp cận lạnh** — mẫu message LinkedIn/Zalo, email cold outreach
5. **Kịch bản gọi điện** — script telesale chi tiết, cách xử lý phản đối
6. **Presentation bán hàng** — cấu trúc pitch, storytelling, demo
7. **Closing Techniques** — 5 kỹ thuật chốt sale phù hợp thị trường Việt
8. **Follow-up System** — quy trình nurture lead, email sequence
9. **Targets & Commission** — mục tiêu doanh số, cơ cấu hoa hồng đề xuất

Viết bằng tiếng Việt với script mẫu cụ thể có thể dùng ngay.`,
};

export type SseEvent =
  | { type: "log"; message: string }
  | { type: "progress"; percent: number }
  | { type: "text"; content: string; text: string }
  | { type: "status"; status: string }
  | { type: "done"; tokens: number; cost: number; runId: number; done: true }
  | { type: "error"; message: string; done: true };

type SendEvent = (data: SseEvent) => void;

function ts() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

const GPT_INPUT_COST_PER_1K = 0.002;
const GPT_OUTPUT_COST_PER_1K = 0.008;

export async function runAgentForProject(
  projectId: number,
  agentType: string,
  project: Project,
  sendEvent?: SendEvent
): Promise<void> {
  const promptFn = AGENT_PROMPTS[agentType];
  if (!promptFn) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  const prompt = promptFn(project);

  sendEvent?.({ type: "log", message: `[${ts()}] Khởi tạo ${agentType.toUpperCase()} agent...` });
  sendEvent?.({ type: "progress", percent: 2 });
  sendEvent?.({ type: "status", status: "running" });

  // Find the specific task
  const allTasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, projectId));

  const task = allTasks.find((r) => r.agentType === agentType);

  if (!task) {
    throw new Error(`Task not found for agent ${agentType}`);
  }

  // Mark this specific task as running
  await db
    .update(agentTasksTable)
    .set({ status: "running", output: null, errorMessage: null, completedAt: null })
    .where(eq(agentTasksTable.id, task.id));

  // Create agent_run record
  const [run] = await db
    .insert(agentRunsTable)
    .values({ taskId: task.id, status: "running" })
    .returning();

  sendEvent?.({ type: "log", message: `[${ts()}] Kết nối GPT-4.1...` });
  sendEvent?.({ type: "progress", percent: 8 });

  let fullOutput = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    sendEvent?.({ type: "log", message: `[${ts()}] Gửi prompt đến model (${prompt.length} ký tự)...` });
    sendEvent?.({ type: "progress", percent: 15 });

    const stream = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 4000,
      stream_options: { include_usage: true },
    });

    sendEvent?.({ type: "log", message: `[${ts()}] Nhận phản hồi từ model, đang stream output...` });
    sendEvent?.({ type: "progress", percent: 20 });

    let chunkCount = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        fullOutput += delta;
        chunkCount++;
        sendEvent?.({ type: "text", content: delta, text: delta });

        // Emit progress heuristic: 20–90% based on output length (expect ~3000 chars)
        const estimatedPercent = Math.min(90, 20 + Math.floor((fullOutput.length / 3000) * 70));
        if (chunkCount % 20 === 0) {
          sendEvent?.({ type: "progress", percent: estimatedPercent });
        }
      }

      // Capture usage from final chunk
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    const totalTokens = inputTokens + outputTokens;
    const cost = (inputTokens / 1000) * GPT_INPUT_COST_PER_1K + (outputTokens / 1000) * GPT_OUTPUT_COST_PER_1K;

    sendEvent?.({ type: "progress", percent: 95 });
    sendEvent?.({ type: "log", message: `[${ts()}] Lưu kết quả vào database...` });

    // Mark task as completed
    await db
      .update(agentTasksTable)
      .set({
        status: "completed",
        output: fullOutput,
        completedAt: new Date(),
      })
      .where(eq(agentTasksTable.id, task.id));

    // Sync output to knowledge base for RAG
    await syncTaskToKnowledgeBase(projectId, agentType, task.agentName, fullOutput).catch((e) =>
      logger.error({ e }, "Failed to sync to knowledge base")
    );

    // Update agent_run record
    await db
      .update(agentRunsTable)
      .set({
        status: "completed",
        finishedAt: new Date(),
        tokens: totalTokens,
        cost,
      })
      .where(eq(agentRunsTable.id, run.id));

    // Recalculate project completion
    const updatedTasks = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.projectId, projectId));

    const completed = updatedTasks.filter((t) => t.status === "completed").length;
    const total = updatedTasks.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const allDone = completed === total;

    await db
      .update(projectsTable)
      .set({
        completionPercent: percent,
        status: allDone ? "completed" : "running",
      })
      .where(eq(projectsTable.id, projectId));

    sendEvent?.({ type: "progress", percent: 100 });
    sendEvent?.({
      type: "log",
      message: `[${ts()}] Hoàn thành ✓ — ${totalTokens.toLocaleString()} tokens — $${cost.toFixed(4)}`,
    });
    sendEvent?.({ type: "done", tokens: totalTokens, cost, runId: run.id, done: true });

  } catch (err) {
    logger.error({ err, agentType, projectId }, "Agent failed");

    await db
      .update(agentTasksTable)
      .set({
        status: "failed",
        errorMessage: String(err),
        completedAt: new Date(),
      })
      .where(eq(agentTasksTable.id, task.id));

    await db
      .update(agentRunsTable)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(agentRunsTable.id, run.id));

    sendEvent?.({ type: "error", message: String(err), done: true });

    throw err;
  }
}
