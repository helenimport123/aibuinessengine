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

  cskh: (p) => `Bạn là AI Customer Success Manager cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}

Hãy xây dựng hệ thống chăm sóc khách hàng toàn diện:
1. **FAQ** — 20 câu hỏi thường gặp và câu trả lời chi tiết
2. **Quy trình xử lý đơn hàng** — từ đặt hàng đến giao hàng đến hậu mãi
3. **Kịch bản xử lý khiếu nại** — các tình huống phổ biến và cách giải quyết
4. **Templates phản hồi** — mẫu tin nhắn/email cho 10 tình huống thường gặp
5. **SLA (Service Level Agreement)** — cam kết thời gian phản hồi
6. **Chính sách đổi trả** — điều khoản rõ ràng, công bằng
7. **Loyalty Program** — chương trình khách hàng thân thiết
8. **Customer Health Score** — cách đo lường sự hài lòng (NPS, CSAT)
9. **Upsell/Cross-sell** — kịch bản tư vấn nâng cấp sản phẩm

Viết bằng tiếng Việt với script và template sẵn sàng sử dụng.`,

  hr: (p) => `Bạn là AI HR Director cho doanh nghiệp Việt Nam mới thành lập.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}

Hãy xây dựng hệ thống nhân sự toàn diện:
1. **Sơ đồ tổ chức** — cấu trúc phòng ban giai đoạn 0-12 tháng
2. **Vị trí tuyển dụng ưu tiên** — 5-8 vị trí quan trọng nhất cần tuyển ngay
3. **Mô tả công việc (JD)** — JD chi tiết cho 3 vị trí core
4. **Quy trình tuyển dụng** — các bước, timeline, bài test đánh giá
5. **Chính sách lương thưởng** — mức lương thị trường, cơ cấu KPI bonus
6. **Onboarding** — quy trình đào tạo nhân viên mới 30-60-90 ngày
7. **Văn hóa doanh nghiệp** — values, mission, vision đề xuất
8. **HR Policies** — nghỉ phép, làm việc từ xa, code of conduct
9. **Kế hoạch tuyển dụng** — roadmap 12 tháng, budget nhân sự

Viết chi tiết bằng tiếng Việt với template JD và quy trình sẵn sàng dùng.`,

  accountant: (p) => `Bạn là AI CFO/Accountant cho doanh nghiệp Việt Nam mới thành lập.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${p.targetMarket ?? "chưa xác định"}

Hãy xây dựng mô hình tài chính toàn diện:
1. **Vốn khởi nghiệp** — ước tính vốn cần thiết để hoạt động 6 tháng đầu
2. **Chi phí setup ban đầu** — danh sách chi tiết (thiết bị, đăng ký, marketing...)
3. **Chi phí vận hành hàng tháng** — fixed và variable costs
4. **Mô hình doanh thu** — pricing strategy, revenue streams
5. **Dự báo doanh thu 12 tháng** — bảng theo tháng với assumptions rõ ràng
6. **Điểm hòa vốn (BEP)** — tính toán khi nào có lãi
7. **Cashflow Projection** — dòng tiền 12 tháng đầu
8. **Các chỉ số tài chính quan trọng** — gross margin, EBITDA, ROI
9. **Nguồn vốn** — vay ngân hàng, nhà đầu tư, bootstrap — pros/cons

Viết bằng tiếng Việt với bảng số liệu cụ thể và giả định rõ ràng.`,

  legal: (p) => `Bạn là AI Legal Counsel cho doanh nghiệp Việt Nam mới thành lập.
Ý tưởng kinh doanh: ${p.businessIdea}
Ngành: ${p.industry ?? "chưa xác định"}

Hãy chuẩn bị hồ sơ pháp lý toàn diện:
1. **Loại hình doanh nghiệp** — TNHH, CP, hộ kinh doanh — phân tích ưu/nhược
2. **Thủ tục đăng ký** — checklist đăng ký kinh doanh tại Việt Nam bước-by-bước
3. **Giấy phép con** — các giấy phép cần thiết cho ngành này
4. **Mẫu hợp đồng** — hợp đồng mua bán/dịch vụ cơ bản
5. **Điều khoản sử dụng** — mẫu Terms & Conditions cho website/app
6. **Chính sách bảo mật** — Privacy Policy theo quy định PDPD Việt Nam
7. **Hợp đồng lao động** — mẫu HĐLĐ chuẩn, phù hợp luật
8. **Bảo vệ sở hữu trí tuệ** — đăng ký nhãn hiệu, bản quyền
9. **Rủi ro pháp lý** — các rủi ro thường gặp và cách phòng tránh
10. **Compliance Checklist** — danh sách tuân thủ pháp luật cần làm ngay

Viết bằng tiếng Việt, chính xác về mặt pháp lý theo luật Việt Nam hiện hành.`,
};

const AGENT_NAMES: Record<string, string> = {
  ceo: "AI CEO",
  marketing: "AI Marketing",
  sales: "AI Sales",
  cskh: "AI CSKH",
  hr: "AI HR",
  accountant: "AI Accountant",
  legal: "AI Legal",
};

type SSECallback = (data: object) => void;

export async function runAgentForProject(
  projectId: number,
  agentType: string,
  project: Project,
  sendEvent?: SSECallback
): Promise<void> {
  const promptFn = AGENT_PROMPTS[agentType];
  if (!promptFn) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  // Find or create task
  let [task] = await db
    .select()
    .from(agentTasksTable)
    .where(
      eq(agentTasksTable.projectId, projectId)
    )
    .then((rows) => rows.filter((r) => r.agentType === agentType));

  if (!task) {
    const [newTask] = await db
      .insert(agentTasksTable)
      .values({
        projectId,
        agentType,
        agentName: AGENT_NAMES[agentType] ?? agentType,
        status: "running",
      })
      .returning();
    task = newTask;
  } else {
    await db
      .update(agentTasksTable)
      .set({ status: "running", output: null, errorMessage: null, completedAt: null })
      .where(eq(agentTasksTable.id, task.id));
  }

  if (sendEvent) sendEvent({ status: "running", agentType });

  let fullOutput = "";

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "Bạn là một AI agent chuyên nghiệp trong lĩnh vực kinh doanh Việt Nam. Hãy cung cấp phân tích chi tiết, thực tế và có thể áp dụng ngay. Sử dụng markdown để định dạng nội dung rõ ràng.",
        },
        {
          role: "user",
          content: promptFn(project),
        },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullOutput += content;
        if (sendEvent) sendEvent({ content });
      }
    }

    // Save completed task
    await db
      .update(agentTasksTable)
      .set({
        status: "completed",
        output: fullOutput,
        completedAt: new Date(),
      })
      .where(eq(agentTasksTable.id, task.id));

    if (sendEvent) sendEvent({ status: "completed", agentType });

    // Update project completion percent
    await updateProjectCompletion(projectId);
  } catch (err) {
    logger.error({ err, agentType, projectId }, "Agent run failed");

    await db
      .update(agentTasksTable)
      .set({
        status: "failed",
        errorMessage: String(err),
        completedAt: new Date(),
      })
      .where(eq(agentTasksTable.id, task.id));

    if (sendEvent) sendEvent({ status: "failed", agentType, error: String(err) });

    await updateProjectCompletion(projectId);

    throw err;
  }
}

async function updateProjectCompletion(projectId: number): Promise<void> {
  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, projectId));

  const total = tasks.length;
  if (total === 0) return;

  const done = tasks.filter(
    (t) => t.status === "completed" || t.status === "failed"
  ).length;

  const completionPercent = Math.round((done / total) * 100);
  const allDone = done === total;
  const allCompleted = tasks.every((t) => t.status === "completed");

  await db
    .update(projectsTable)
    .set({
      completionPercent,
      status: allDone ? (allCompleted ? "completed" : "running") : "running",
    })
    .where(eq(projectsTable.id, projectId));
}
