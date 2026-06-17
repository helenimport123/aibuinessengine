import { eq } from "drizzle-orm";
import { db, agentTasksTable, projectsTable, agentRunsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";
import { syncTaskToKnowledgeBase } from "./rag";
import { saveMemory } from "./memory";
import { emitJobEvent } from "./queue";

type Project = typeof projectsTable.$inferSelect;

export type ExecutionPlanItem = { agent: string; reason: string };

export const ALL_AGENT_LABELS: Record<string, string> = {
  ceo: "AI CEO",
  marketing: "AI Marketing",
  sales: "AI Sales",
  cskh: "AI CSKH",
  hr: "AI HR",
  accountant: "AI Kế Toán",
  legal: "AI Pháp Lý",
};

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

  cskh: (p) => `Bạn là AI Customer Service Director chuyên xây dựng hệ thống dịch vụ khách hàng cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng chiến lược dịch vụ khách hàng toàn diện:
1. **Customer Journey Map** — hành trình khách hàng từ nhận biết đến trung thành
2. **Kênh hỗ trợ** — Zalo OA, Facebook Messenger, hotline, email, live chat
3. **SLA & Quy trình** — thời gian phản hồi chuẩn, quy trình xử lý khiếu nại
4. **Kịch bản CSKH** — script xử lý 10 tình huống phổ biến nhất
5. **Chương trình khách hàng thân thiết** — loyalty program, điểm thưởng, ưu đãi
6. **Chỉ số đo lường** — NPS, CSAT, CES, first response time, resolution rate
7. **Công cụ & Phần mềm** — CRM, helpdesk, chatbot phù hợp quy mô
8. **Đào tạo nhân viên CSKH** — quy trình onboarding, kịch bản soft skills
9. **Upsell & Cross-sell** — kỹ thuật tăng doanh thu qua CSKH

Viết chi tiết bằng tiếng Việt, thực tế và có thể áp dụng ngay.`,

  hr: (p) => `Bạn là AI HR Director chuyên xây dựng chiến lược nhân sự cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng chiến lược nhân sự toàn diện:
1. **Cơ cấu tổ chức** — sơ đồ tổ chức gợi ý cho 3 giai đoạn: 0-10, 10-50, 50+ nhân sự
2. **Kế hoạch tuyển dụng** — vị trí ưu tiên tuyển, JD mẫu cho 3 vị trí chủ chốt
3. **Chính sách lương thưởng** — thang lương tham khảo theo vị trí, KPI bonus
4. **Quy trình Onboarding** — 30-60-90 ngày đầu cho nhân viên mới
5. **Văn hóa doanh nghiệp** — core values, rituals, employer branding
6. **Phúc lợi cạnh tranh** — gói benefits thu hút talent trong ngành
7. **Quản lý hiệu suất** — OKRs, 1-on-1, performance review cycle
8. **Giữ chân nhân tài** — retention strategies, career path rõ ràng
9. **Tuân thủ Luật Lao động** — các điểm pháp lý quan trọng cần lưu ý

Viết chi tiết bằng tiếng Việt với mẫu tài liệu cụ thể.`,

  accountant: (p) => `Bạn là AI CFO/Kế Toán Trưởng chuyên tư vấn tài chính cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng kế hoạch tài chính toàn diện:
1. **Mô hình doanh thu** — revenue streams, pricing model, unit economics
2. **Chi phí khởi nghiệp** — bảng chi phí ban đầu chi tiết (CAPEX & OPEX)
3. **Dự báo tài chính 3 năm** — P&L dự kiến theo quý, điểm hòa vốn
4. **Dòng tiền** — cash flow forecast 12 tháng đầu, burn rate, runway
5. **Cơ cấu vốn** — nguồn vốn khởi nghiệp, tỷ lệ equity/debt gợi ý
6. **Hệ thống kế toán** — phần mềm kế toán, quy trình invoice, thu chi
7. **Thuế & Pháp lý** — các loại thuế phải nộp, ưu đãi thuế nếu có
8. **KPIs Tài chính** — gross margin, EBITDA, CAC payback, LTV/CAC
9. **Kế hoạch gọi vốn** — investor pitch financials, valuation approach

Viết chi tiết bằng tiếng Việt với bảng số liệu cụ thể và công thức tính.`,

  legal: (p) => `Bạn là AI Legal Counsel chuyên tư vấn pháp lý cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng khung pháp lý toàn diện:
1. **Loại hình doanh nghiệp** — so sánh TNHH, Cổ phần, Hộ kinh doanh — đề xuất phù hợp nhất
2. **Thủ tục thành lập** — các bước đăng ký kinh doanh, giấy tờ cần thiết, thời gian
3. **Giấy phép con** — các giấy phép ngành đặc thù cần xin (nếu có)
4. **Hợp đồng mẫu** — hợp đồng với khách hàng, nhà cung cấp, đối tác — điều khoản quan trọng
5. **Sở hữu trí tuệ** — đăng ký thương hiệu, bảo vệ bí quyết kinh doanh
6. **Tuân thủ dữ liệu** — Nghị định 13/2023 về PDPA, chính sách privacy
7. **Lao động & Nhân sự** — hợp đồng lao động đúng luật, BHXH, BHYT
8. **Thuế & Kế toán** — nghĩa vụ thuế, VAT, TNCN, thuế TNDN
9. **Rủi ro pháp lý** — top 5 rủi ro pháp lý trong ngành và cách phòng tránh

Viết chi tiết bằng tiếng Việt, dẫn chiếu luật cụ thể khi cần.`,
};

export type SseEvent =
  | { type: "log"; message: string }
  | { type: "progress"; percent: number }
  | { type: "text"; content: string; text: string }
  | { type: "status"; status: string }
  | { type: "plan"; plan: ExecutionPlanItem[] }
  | { type: "done"; tokens: number; cost: number; runId: number; done: true }
  | { type: "error"; message: string; done: true };

type SendEvent = (data: SseEvent) => void;

function ts() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

const GPT_INPUT_COST_PER_1K = 0.002;
const GPT_OUTPUT_COST_PER_1K = 0.008;

async function fetchCeoExecutionPlan(
  project: Project,
  ceoAnalysis: string
): Promise<ExecutionPlanItem[]> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4.1",
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content: `Ý tưởng kinh doanh: ${project.businessIdea}\nNgành: ${project.industry ?? "chưa xác định"}\nThị trường: ${project.targetMarket ?? "chưa xác định"}`,
      },
      { role: "assistant", content: ceoAnalysis },
      {
        role: "user",
        content: `Dựa trên phân tích trên, hãy xác định các AI agents nào CẦN THIẾT để thực thi kế hoạch kinh doanh này.

Trả lời CHÍNH XÁC theo JSON (không thêm gì khác):
{"agents":[{"agent":"marketing","reason":"lý do ngắn gọn tiếng Việt"},{"agent":"sales","reason":"lý do ngắn gọn tiếng Việt"}]}

Agents có sẵn: marketing, sales, cskh, hr, accountant, legal
Chỉ chọn agents thực sự cần thiết cho ý tưởng này. Không nhất thiết phải chọn tất cả.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  const agents: ExecutionPlanItem[] = Array.isArray(parsed.agents) ? parsed.agents : [];
  return agents.filter(
    (a) => typeof a.agent === "string" && a.agent in AGENT_PROMPTS && a.agent !== "ceo"
  );
}

async function createOrchestratedTasks(
  projectId: number,
  plan: ExecutionPlanItem[]
): Promise<Array<{ id: number; agentType: string }>> {
  if (plan.length === 0) return [];
  const now = new Date();
  const created = await db
    .insert(agentTasksTable)
    .values(
      plan.map((item) => ({
        projectId,
        agentType: item.agent,
        agentName: ALL_AGENT_LABELS[item.agent] ?? item.agent,
        status: "pending" as const,
        queuedAt: now,
      }))
    )
    .returning({ id: agentTasksTable.id, agentType: agentTasksTable.agentType });
  return created;
}

export async function runAgentForProject(
  projectId: number,
  agentType: string,
  project: Project,
  sendEvent?: SendEvent
): Promise<void> {
  const promptFn = AGENT_PROMPTS[agentType];
  if (!promptFn) throw new Error(`Unknown agent type: ${agentType}`);

  const prompt = promptFn(project);

  sendEvent?.({ type: "log", message: `[${ts()}] Khởi tạo ${agentType.toUpperCase()} agent...` });
  sendEvent?.({ type: "progress", percent: 2 });
  sendEvent?.({ type: "status", status: "running" });

  const allTasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, projectId));

  const task = allTasks.find((r) => r.agentType === agentType);
  if (!task) throw new Error(`Task not found for agent ${agentType}`);

  await db
    .update(agentTasksTable)
    .set({ status: "running", output: null, errorMessage: null, completedAt: null })
    .where(eq(agentTasksTable.id, task.id));

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
        const pct = Math.min(agentType === "ceo" ? 75 : 90, 20 + Math.floor((fullOutput.length / 3000) * (agentType === "ceo" ? 55 : 70)));
        if (chunkCount % 20 === 0) sendEvent?.({ type: "progress", percent: pct });
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    const totalTokens = inputTokens + outputTokens;
    const cost = (inputTokens / 1000) * GPT_INPUT_COST_PER_1K + (outputTokens / 1000) * GPT_OUTPUT_COST_PER_1K;

    // ── CEO orchestration ────────────────────────────────────────────────
    let executionPlan: ExecutionPlanItem[] = [];
    if (agentType === "ceo") {
      sendEvent?.({ type: "progress", percent: 80 });
      sendEvent?.({ type: "log", message: `[${ts()}] CEO đang lập kế hoạch thực thi...` });

      try {
        executionPlan = await fetchCeoExecutionPlan(project, fullOutput);

        if (executionPlan.length > 0) {
          await db
            .update(projectsTable)
            .set({ executionPlan: JSON.stringify(executionPlan) })
            .where(eq(projectsTable.id, projectId));

          const createdTasks = await createOrchestratedTasks(projectId, executionPlan);

          sendEvent?.({
            type: "log",
            message: `[${ts()}] Kế hoạch: ${executionPlan.map((a) => a.agent.toUpperCase()).join(", ")} — đã đưa vào queue.`,
          });
          sendEvent?.({ type: "plan", plan: executionPlan });

          // Emit job_queued for each orchestrated task
          for (const t of createdTasks) {
            const planItem = executionPlan.find((e) => e.agent === t.agentType);
            emitJobEvent({
              type: "job_queued",
              taskId: t.id,
              agentType: t.agentType,
              agentName: ALL_AGENT_LABELS[t.agentType] ?? t.agentType,
              projectId,
              projectName: project.name,
            });
            logger.info({ taskId: t.id, agentType: t.agentType, reason: planItem?.reason }, "Orchestrated task queued");
          }
          // Worker will pick them up automatically — no direct fire
        }
      } catch (planErr) {
        logger.error({ planErr, projectId }, "Failed to fetch CEO execution plan");
        sendEvent?.({ type: "log", message: `[${ts()}] Không thể tạo execution plan.` });
      }
    }
    // ────────────────────────────────────────────────────────────────────

    sendEvent?.({ type: "progress", percent: 95 });
    sendEvent?.({ type: "log", message: `[${ts()}] Lưu kết quả vào database...` });

    await db
      .update(agentTasksTable)
      .set({ status: "completed", output: fullOutput, completedAt: new Date() })
      .where(eq(agentTasksTable.id, task.id));

    await syncTaskToKnowledgeBase(projectId, agentType, task.agentName, fullOutput).catch((e) =>
      logger.error({ e }, "Failed to sync to knowledge base")
    );

    const memoryTypeMap: Record<string, import("@workspace/db").MemoryType> = {
      ceo: "ceo_report",
      marketing: "marketing_plan",
      sales: "sales_playbook",
    };
    const memType = memoryTypeMap[agentType];
    if (memType) {
      await saveMemory(projectId, memType, fullOutput).catch((e) =>
        logger.error({ e }, "Failed to save to project memory")
      );
    }

    await db
      .update(agentRunsTable)
      .set({ status: "completed", finishedAt: new Date(), tokens: totalTokens, cost })
      .where(eq(agentRunsTable.id, run.id));

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
      .set({ completionPercent: percent, status: allDone ? "completed" : "running" })
      .where(eq(projectsTable.id, projectId));

    sendEvent?.({ type: "progress", percent: 100 });
    sendEvent?.({ type: "log", message: `[${ts()}] Hoàn thành ✓ — ${totalTokens.toLocaleString()} tokens — $${cost.toFixed(4)}` });
    sendEvent?.({ type: "done", tokens: totalTokens, cost, runId: run.id, done: true });
  } catch (err) {
    logger.error({ err, agentType, projectId }, "Agent failed");

    await db
      .update(agentTasksTable)
      .set({ status: "failed", errorMessage: String(err), completedAt: new Date() })
      .where(eq(agentTasksTable.id, task.id));

    await db
      .update(agentRunsTable)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(agentRunsTable.id, run.id));

    if (agentType === "ceo") {
      await db
        .update(projectsTable)
        .set({ status: "draft" })
        .where(eq(projectsTable.id, projectId));
    }

    sendEvent?.({ type: "error", message: String(err), done: true });
    throw err;
  }
}
