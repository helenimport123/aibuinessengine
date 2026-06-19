import { eq } from "drizzle-orm";
import { db, agentTasksTable, projectsTable, agentRunsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import pino from "pino";
import { checkBudget, checkDailyQuota, trackUsage } from "./cost";
import { syncTaskToKnowledgeBase } from "./rag";
import { saveMemory } from "./memory";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

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

export type SseEvent =
  | { type: "log"; message: string }
  | { type: "progress"; percent: number }
  | { type: "text"; content: string; text: string }
  | { type: "status"; status: string }
  | { type: "plan"; plan: ExecutionPlanItem[] }
  | { type: "done"; tokens: number; cost: number; runId: number; done: true }
  | { type: "error"; message: string; done: true };

type SendEvent = (data: SseEvent) => void;

/** Callback for CEO orchestration — API server wires this to enqueue BullMQ jobs */
export type OnTasksCreated = (tasks: Array<{ id: number; agentType: string; agentName: string; projectId: number; projectName: string }>) => void;

function ts() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

const GPT_INPUT_COST_PER_1K = 0.002;
const GPT_OUTPUT_COST_PER_1K = 0.008;

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
2. **Customer Persona** — 2 persona chi tiết
3. **Chiến lược kênh** — Facebook, TikTok, Zalo, Google, SEO/SEM
4. **Content Marketing** — chủ đề content, format, lịch đăng mẫu 1 tháng
5. **Facebook Ads** — cấu trúc chiến dịch, audience targeting, mẫu ad copy
6. **Google Ads** — từ khóa mục tiêu, cấu trúc nhóm quảng cáo
7. **Budget Marketing** — phân bổ ngân sách theo kênh
8. **KPIs** — CPC, CPL, ROAS, CAC
9. **90-Day Action Plan**

Viết chi tiết bằng tiếng Việt với ví dụ cụ thể.`,

  sales: (p) => `Bạn là AI Sales Director chuyên xây dựng hệ thống bán hàng cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng sales playbook đầy đủ:
1. **ICP** — mô tả chi tiết khách hàng lý tưởng
2. **Nguồn Lead** — 5-7 kênh tìm kiếm khách hàng
3. **Sales Funnel** — Awareness đến Purchase đến Retention
4. **Kịch bản tiếp cận lạnh** — message LinkedIn/Zalo, email cold outreach
5. **Kịch bản gọi điện** — script telesale, xử lý phản đối
6. **Presentation bán hàng** — cấu trúc pitch, storytelling
7. **Closing Techniques** — 5 kỹ thuật chốt sale
8. **Follow-up System** — quy trình nurture lead
9. **Targets & Commission** — mục tiêu doanh số, hoa hồng

Viết bằng tiếng Việt với script mẫu cụ thể.`,

  cskh: (p) => `Bạn là AI Customer Service Director cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}

Xây dựng chiến lược CSKH toàn diện:
1. **Customer Journey Map**
2. **Kênh hỗ trợ** — Zalo OA, Facebook Messenger, hotline
3. **SLA & Quy trình** — xử lý khiếu nại
4. **Kịch bản CSKH** — 10 tình huống phổ biến
5. **Loyalty Program** — điểm thưởng, ưu đãi
6. **Chỉ số đo lường** — NPS, CSAT, CES
7. **Công cụ & Phần mềm** — CRM, helpdesk
8. **Đào tạo nhân viên CSKH**
9. **Upsell & Cross-sell**

Viết chi tiết bằng tiếng Việt.`,

  hr: (p) => `Bạn là AI HR Director cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}

Xây dựng chiến lược nhân sự toàn diện:
1. **Cơ cấu tổ chức** — 0-10, 10-50, 50+ nhân sự
2. **Kế hoạch tuyển dụng** — JD mẫu 3 vị trí chủ chốt
3. **Chính sách lương thưởng** — thang lương, KPI bonus
4. **Quy trình Onboarding** — 30-60-90 ngày
5. **Văn hóa doanh nghiệp** — core values, employer branding
6. **Phúc lợi cạnh tranh**
7. **Quản lý hiệu suất** — OKRs, performance review
8. **Giữ chân nhân tài**
9. **Tuân thủ Luật Lao động**

Viết chi tiết bằng tiếng Việt.`,

  accountant: (p) => `Bạn là AI CFO/Kế Toán Trưởng cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}

Xây dựng kế hoạch tài chính toàn diện:
1. **Mô hình doanh thu** — revenue streams, pricing model
2. **Chi phí khởi nghiệp** — CAPEX & OPEX
3. **Dự báo tài chính 3 năm** — P&L, điểm hòa vốn
4. **Dòng tiền** — cash flow 12 tháng, burn rate
5. **Cơ cấu vốn** — equity/debt
6. **Hệ thống kế toán** — phần mềm, quy trình invoice
7. **Thuế & Pháp lý** — VAT, TNCN, TNDN
8. **KPIs Tài chính** — gross margin, EBITDA, LTV/CAC
9. **Kế hoạch gọi vốn**

Viết chi tiết bằng tiếng Việt với bảng số liệu.`,

  legal: (p) => `Bạn là AI Legal Counsel cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}

Xây dựng khung pháp lý toàn diện:
1. **Loại hình doanh nghiệp** — TNHH, Cổ phần, Hộ kinh doanh
2. **Thủ tục thành lập** — các bước, giấy tờ
3. **Giấy phép con** — giấy phép ngành đặc thù
4. **Hợp đồng mẫu** — với khách hàng, nhà cung cấp, đối tác
5. **Sở hữu trí tuệ** — đăng ký thương hiệu
6. **Tuân thủ dữ liệu** — Nghị định 13/2023
7. **Lao động & Nhân sự** — hợp đồng lao động, BHXH
8. **Thuế & Kế toán** — VAT, TNCN, TNDN
9. **Rủi ro pháp lý** — top 5 rủi ro trong ngành

Viết chi tiết bằng tiếng Việt, dẫn chiếu luật cụ thể.`,
};

async function generateExecutiveSummary(
  projectId: number,
  tasks: Array<typeof agentTasksTable.$inferSelect>,
  project: Project
): Promise<void> {
  const reports = tasks
    .filter((t) => t.status === "completed" && t.output)
    .map((t) => `## ${t.agentName}\n\n${t.output}`)
    .join("\n\n---\n\n");

  if (!reports) return;

  const resp = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Bạn là AI CEO tổng hợp báo cáo kinh doanh.

Ý tưởng kinh doanh: ${project.businessIdea}
Ngành: ${project.industry ?? "chưa xác định"}

Dưới đây là báo cáo từ ${tasks.length} AI agents:

${reports}

---

Hãy tổng hợp thành **Executive Summary** ngắn gọn, súc tích (600-800 từ) bao gồm:

1. **Tóm tắt cơ hội thị trường** — tại sao ý tưởng này khả thi
2. **Chiến lược triển khai ưu tiên** — 5 hành động cụ thể nhất từ tất cả các báo cáo
3. **Ngân sách & Dòng tiền** — con số chủ chốt từ báo cáo tài chính
4. **Rủi ro chính** — top 3 rủi ro cần chú ý
5. **Lời khuyên kết luận** — quyết định quan trọng nhất cần thực hiện ngay

Viết bằng tiếng Việt, markdown format, chuyên nghiệp và hành động được.`,
      },
    ],
  });

  const summary = resp.choices[0]?.message?.content ?? "";
  if (summary) {
    await db.update(projectsTable).set({ executiveSummary: summary }).where(eq(projectsTable.id, projectId));
    logger.info({ projectId }, "Executive summary generated and saved");
  }
}

async function fetchCeoExecutionPlan(project: Project, ceoAnalysis: string): Promise<ExecutionPlanItem[]> {
  const resp = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 600,
    messages: [
      { role: "user", content: `Ý tưởng kinh doanh: ${project.businessIdea}\nNgành: ${project.industry ?? "chưa xác định"}\nThị trường: ${project.targetMarket ?? "chưa xác định"}` },
      { role: "assistant", content: ceoAnalysis },
      { role: "user", content: `Dựa trên phân tích trên, hãy xác định các AI agents nào CẦN THIẾT để thực thi kế hoạch kinh doanh này.\n\nTrả lời CHÍNH XÁC theo JSON:\n{"agents":[{"agent":"marketing","reason":"lý do ngắn gọn"},{"agent":"sales","reason":"lý do ngắn gọn"}]}\n\nAgents có sẵn: marketing, sales, cskh, hr, accountant, legal\nChỉ chọn agents thực sự cần thiết.` },
    ],
    response_format: { type: "json_object" },
  });
  const raw = resp.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  const agents: ExecutionPlanItem[] = Array.isArray(parsed.agents) ? parsed.agents : [];
  return agents.filter((a) => typeof a.agent === "string" && a.agent in AGENT_PROMPTS && a.agent !== "ceo");
}

async function createOrchestratedTasks(projectId: number, plan: ExecutionPlanItem[]): Promise<Array<{ id: number; agentType: string; agentName: string }>> {
  if (plan.length === 0) return [];
  const now = new Date();
  return db
    .insert(agentTasksTable)
    .values(plan.map((item) => ({
      projectId,
      agentType: item.agent,
      agentName: ALL_AGENT_LABELS[item.agent] ?? item.agent,
      status: "pending" as const,
      queuedAt: now,
    })))
    .returning({ id: agentTasksTable.id, agentType: agentTasksTable.agentType, agentName: agentTasksTable.agentName });
}

export async function runAgentForProject(
  projectId: number,
  agentType: string,
  project: Project,
  sendEvent?: SendEvent,
  onTasksCreated?: OnTasksCreated
): Promise<void> {
  const promptFn = AGENT_PROMPTS[agentType];
  if (!promptFn) throw new Error(`Unknown agent type: ${agentType}`);

  const prompt = promptFn(project);
  sendEvent?.({ type: "log", message: `[${ts()}] Khởi tạo ${agentType.toUpperCase()} agent...` });
  sendEvent?.({ type: "progress", percent: 2 });
  sendEvent?.({ type: "status", status: "running" });

  const allTasks = await db.select().from(agentTasksTable).where(eq(agentTasksTable.projectId, projectId));
  const task = allTasks.find((r) => r.agentType === agentType);
  if (!task) throw new Error(`Task not found for agent ${agentType}`);

  await db.update(agentTasksTable).set({ status: "running", output: null, errorMessage: null, completedAt: null }).where(eq(agentTasksTable.id, task.id));

  const [run] = await db.insert(agentRunsTable).values({ taskId: task.id, status: "running" }).returning();

  sendEvent?.({ type: "log", message: `[${ts()}] Kết nối Groq Llama 3.3 70B...` });
  sendEvent?.({ type: "progress", percent: 8 });

  let fullOutput = "";
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    if (project.userId) {
      sendEvent?.({ type: "log", message: `[${ts()}] Kiểm tra ngân sách...` });
      const [budgetRes, quotaRes] = await Promise.all([checkBudget(project.userId), checkDailyQuota(project.userId)]);
      if (!budgetRes.allowed) throw new Error(`Ngân sách tháng đã hết: đã dùng $${budgetRes.spent.toFixed(4)} / $${budgetRes.limit.toFixed(2)}`);
      if (!quotaRes.allowed) throw new Error(`Quota token hàng ngày đã hết: ${quotaRes.used.toLocaleString()} / ${quotaRes.limit.toLocaleString()} tokens`);
    }

    sendEvent?.({ type: "log", message: `[${ts()}] Gửi prompt đến model (${prompt.length} ký tự)...` });
    sendEvent?.({ type: "progress", percent: 15 });

    const stream = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
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
      if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens ?? 0; outputTokens = chunk.usage.completion_tokens ?? 0; }
    }

    const totalTokens = inputTokens + outputTokens;
    const cost = (inputTokens / 1000) * GPT_INPUT_COST_PER_1K + (outputTokens / 1000) * GPT_OUTPUT_COST_PER_1K;

    if (project.userId) await trackUsage(project.userId, totalTokens, cost, "agent").catch(() => {});

    if (agentType === "ceo") {
      sendEvent?.({ type: "progress", percent: 80 });
      sendEvent?.({ type: "log", message: `[${ts()}] CEO đang lập kế hoạch thực thi...` });
      try {
        // ORCHESTRATOR MODE: if executionPlan already pre-set (by /api/orchestrate), 
        // use existing tasks instead of creating new ones to avoid duplicates
        const existingPlan = project.executionPlan ? (JSON.parse(project.executionPlan) as ExecutionPlanItem[]) : null;
        const existingSubTasks = allTasks.filter((t) => t.agentType !== "ceo" && t.status === "pending");

        if (existingPlan && existingSubTasks.length > 0) {
          // Orchestrator mode — tasks already pre-created, just enqueue them
          sendEvent?.({ type: "log", message: `[${ts()}] Orchestrator mode: ${existingSubTasks.map((t) => t.agentType.toUpperCase()).join(", ")} — đưa vào queue.` });
          sendEvent?.({ type: "plan", plan: existingPlan });
          // Mark all subordinate tasks as queued
          const now2 = new Date();
          for (const t of existingSubTasks) {
            await db.update(agentTasksTable).set({ queuedAt: now2 }).where(eq(agentTasksTable.id, t.id));
          }
          if (onTasksCreated) {
            onTasksCreated(existingSubTasks.map((t) => ({ id: t.id, agentType: t.agentType, agentName: t.agentName, projectId, projectName: project.name })));
          }
        } else {
          // Standard mode — CEO decides which agents to run
          const executionPlan = await fetchCeoExecutionPlan(project, fullOutput);
          if (executionPlan.length > 0) {
            await db.update(projectsTable).set({ executionPlan: JSON.stringify(executionPlan) }).where(eq(projectsTable.id, projectId));
            const createdTasks = await createOrchestratedTasks(projectId, executionPlan);
            sendEvent?.({ type: "log", message: `[${ts()}] Kế hoạch: ${executionPlan.map((a) => a.agent.toUpperCase()).join(", ")} — đã đưa vào queue.` });
            sendEvent?.({ type: "plan", plan: executionPlan });
            if (onTasksCreated) {
              onTasksCreated(createdTasks.map((t) => ({ id: t.id, agentType: t.agentType, agentName: t.agentName, projectId, projectName: project.name })));
            }
          }
        }
      } catch (planErr) {
        logger.error({ planErr, projectId }, "Failed to fetch CEO execution plan");
        sendEvent?.({ type: "log", message: `[${ts()}] Không thể tạo execution plan.` });
      }
    }

    sendEvent?.({ type: "progress", percent: 95 });
    sendEvent?.({ type: "log", message: `[${ts()}] Lưu kết quả vào database...` });

    await db.update(agentTasksTable).set({ status: "completed", output: fullOutput, completedAt: new Date() }).where(eq(agentTasksTable.id, task.id));
    await syncTaskToKnowledgeBase(projectId, agentType, task.agentName, fullOutput).catch((e) => logger.error({ e }, "Failed KB sync"));

    const memoryTypeMap: Record<string, import("@workspace/db").MemoryType> = {
      ceo: "ceo_report",
      marketing: "marketing_plan",
      sales: "sales_playbook",
      hr: "hr_plan",
      cskh: "cskh_plan",
      accountant: "accountant_plan",
      legal: "legal_plan",
    };
    const memType = memoryTypeMap[agentType];
    if (memType) await saveMemory(projectId, memType, fullOutput).catch((e) => logger.error({ e }, "Failed memory save"));

    await db.update(agentRunsTable).set({ status: "completed", finishedAt: new Date(), tokens: totalTokens, cost }).where(eq(agentRunsTable.id, run.id));

    const updatedTasks = await db.select().from(agentTasksTable).where(eq(agentTasksTable.projectId, projectId));
    const completed = updatedTasks.filter((t) => t.status === "completed").length;
    const total = updatedTasks.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const allDone = completed === total;

    await db.update(projectsTable).set({ completionPercent: percent, status: allDone ? "completed" : "running" }).where(eq(projectsTable.id, projectId));

    // Auto-generate executive summary when all agents are done
    if (allDone && total > 1) {
      generateExecutiveSummary(projectId, updatedTasks, project).catch((e) =>
        logger.error({ e, projectId }, "Failed to generate executive summary")
      );
    }

    sendEvent?.({ type: "progress", percent: 100 });
    sendEvent?.({ type: "log", message: `[${ts()}] Hoàn thành ✓ — ${totalTokens.toLocaleString()} tokens — $${cost.toFixed(4)}` });
    sendEvent?.({ type: "done", tokens: totalTokens, cost, runId: run.id, done: true });
  } catch (err) {
    // Full API error logging: status code, response body, stack trace
    const apiErr = err as any;
    logger.error(
      {
        agentType,
        projectId,
        errorMessage: apiErr?.message,
        errorName: apiErr?.name,
        httpStatus: apiErr?.status ?? apiErr?.statusCode,
        responseBody: apiErr?.error ?? apiErr?.body ?? apiErr?.response?.data,
        requestId: apiErr?.headers?.["x-request-id"],
        stack: apiErr?.stack,
      },
      "Agent failed — full API error"
    );
    // Also log raw to stderr so it appears even without pino-pretty
    console.error("[AGENT ERROR]", {
      agentType,
      projectId,
      status: apiErr?.status ?? apiErr?.statusCode,
      body: JSON.stringify(apiErr?.error ?? apiErr?.body ?? null),
      message: apiErr?.message,
      stack: apiErr?.stack,
    });
    await db.update(agentTasksTable).set({ status: "failed", errorMessage: String(err), completedAt: new Date() }).where(eq(agentTasksTable.id, task.id));
    await db.update(agentRunsTable).set({ status: "failed", finishedAt: new Date() }).where(eq(agentRunsTable.id, run.id));
    if (agentType === "ceo") await db.update(projectsTable).set({ status: "draft" }).where(eq(projectsTable.id, projectId));
    sendEvent?.({ type: "error", message: String(err), done: true });
    throw err;
  }
}
