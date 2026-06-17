import { eq } from "drizzle-orm";
import { db, agentTasksTable, projectsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

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

type SendEvent = (data: object) => void;

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

  // Mark task as running
  await db
    .update(agentTasksTable)
    .set({ status: "running", output: null, errorMessage: null })
    .where(
      eq(agentTasksTable.projectId, projectId)
    );

  // Find the specific task
  const [task] = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, projectId))
    .then((rows) => rows.filter((r) => r.agentType === agentType));

  if (!task) {
    throw new Error(`Task not found for agent ${agentType}`);
  }

  // Mark this specific task as running
  await db
    .update(agentTasksTable)
    .set({ status: "running", output: null, errorMessage: null, completedAt: null })
    .where(eq(agentTasksTable.id, task.id));

  let fullOutput = "";

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      stream: true,
      max_tokens: 4000,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        fullOutput += delta;
        if (sendEvent) {
          sendEvent({ text: delta });
        }
      }
    }

    // Mark task as completed
    await db
      .update(agentTasksTable)
      .set({
        status: "completed",
        output: fullOutput,
        completedAt: new Date(),
      })
      .where(eq(agentTasksTable.id, task.id));

    // Recalculate project completion
    const allTasks = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.projectId, projectId));

    const completed = allTasks.filter((t) => t.status === "completed").length;
    const total = allTasks.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const allDone = completed === total;

    await db
      .update(projectsTable)
      .set({
        completionPercent: percent,
        status: allDone ? "completed" : "running",
      })
      .where(eq(projectsTable.id, projectId));

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

    throw err;
  }
}
