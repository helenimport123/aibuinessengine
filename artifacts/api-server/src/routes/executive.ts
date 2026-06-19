import { Router, type IRouter } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, projectsTable, agentTasksTable, projectMemoryTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth, getAuthUser } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(v: unknown): number | null {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ownerFilter(userId: string | null) {
  if (!userId) return isNull(projectsTable.userId);
  return or(eq(projectsTable.userId, userId), isNull(projectsTable.userId));
}

export type KpiItem = {
  value: number;
  unit: string;
  display: string;
};

export type DimensionScores = {
  market: number;
  competition: number;
  finance: number;
  legal: number;
  marketing: number;
};

export type BusinessScore = {
  overall: number;
  level: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  dimensions: DimensionScores;
  risks: string[];
  opportunities: string[];
};

export type ExecutiveData = {
  kpis: {
    investment: KpiItem;
    revenue: KpiItem;
    profit: KpiItem;
    breakEven: KpiItem;
    employeeCount: KpiItem;
    marketingBudget: KpiItem;
  };
  score: BusinessScore;
  investorSummary: string;
  generatedAt: string;
};

async function getCachedExecutiveData(projectId: number): Promise<ExecutiveData | null> {
  const [entry] = await db
    .select()
    .from(projectMemoryTable)
    .where(
      and(
        eq(projectMemoryTable.projectId, projectId),
        eq(projectMemoryTable.type, "executive_data")
      )
    )
    .limit(1);

  if (!entry) return null;
  try {
    return JSON.parse(entry.content) as ExecutiveData;
  } catch {
    return null;
  }
}

async function saveExecutiveData(projectId: number, data: ExecutiveData): Promise<void> {
  const [existing] = await db
    .select({ id: projectMemoryTable.id })
    .from(projectMemoryTable)
    .where(
      and(
        eq(projectMemoryTable.projectId, projectId),
        eq(projectMemoryTable.type, "executive_data")
      )
    )
    .limit(1);

  const content = JSON.stringify(data);
  if (existing) {
    await db
      .update(projectMemoryTable)
      .set({ content, createdAt: new Date() })
      .where(eq(projectMemoryTable.id, existing.id));
  } else {
    await db.insert(projectMemoryTable).values({ projectId, type: "executive_data", content });
  }
}

function buildAgentContext(tasks: Array<{ agentType: string; agentName: string; output: string | null; status: string }>): string {
  const completed = tasks.filter((t) => t.status === "completed" && t.output);
  if (completed.length === 0) return "";
  return completed
    .map((t) => `=== ${t.agentName.toUpperCase()} ===\n${t.output}`)
    .join("\n\n---\n\n");
}

function scoreLevel(overall: number): "EXCELLENT" | "GOOD" | "FAIR" | "POOR" {
  if (overall >= 85) return "EXCELLENT";
  if (overall >= 70) return "GOOD";
  if (overall >= 50) return "FAIR";
  return "POOR";
}

// GET /api/projects/:id/executive — fetch project + cached executive data
router.get("/projects/:id/executive", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const projectId = parseId(req.params.id);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), ownerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, projectId))
    .orderBy(agentTasksTable.id);

  const executive = await getCachedExecutiveData(projectId);
  res.json({ project, tasks, executive });
});

// POST /api/projects/:id/executive/generate — AI analysis → cache → return
router.post("/projects/:id/executive/generate", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuthUser(req);
  const projectId = parseId(req.params.id);
  if (!projectId) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), ownerFilter(userId)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, projectId));

  const agentContext = buildAgentContext(tasks);
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  if (completedCount === 0) {
    res.status(422).json({ error: "Chưa có agent nào hoàn thành. Hãy chạy Auto Orchestrate trước." });
    return;
  }

  const prompt = `Bạn là chuyên gia phân tích kinh doanh. Phân tích kế hoạch kinh doanh dưới đây và trả về JSON.

Ý tưởng kinh doanh: ${project.businessIdea}
Ngành: ${project.industry ?? "chưa xác định"}
Thị trường mục tiêu: ${project.targetMarket ?? "chưa xác định"}

DỮ LIỆU TỪ ${completedCount} AI AGENTS:

${agentContext}

---

Trả về CHÍNH XÁC JSON sau (không có text nào khác):
{
  "kpis": {
    "investment": {"value": <số tiền vốn đầu tư ban đầu tính bằng triệu VNĐ, ví dụ 500>, "unit": "triệu VNĐ", "display": "<ví dụ: 500 triệu VNĐ>"},
    "revenue": {"value": <doanh thu năm 1 triệu VNĐ>, "unit": "triệu VNĐ", "display": "<ví dụ: 2 tỷ VNĐ>"},
    "profit": {"value": <lợi nhuận ròng năm 1 triệu VNĐ>, "unit": "triệu VNĐ", "display": "<ví dụ: 300 triệu VNĐ>"},
    "breakEven": {"value": <số tháng hòa vốn>, "unit": "tháng", "display": "<ví dụ: 8 tháng>"},
    "employeeCount": {"value": <số nhân viên năm 1>, "unit": "người", "display": "<ví dụ: 15 người>"},
    "marketingBudget": {"value": <ngân sách marketing triệu VNĐ>, "unit": "triệu VNĐ", "display": "<ví dụ: 200 triệu VNĐ>"}
  },
  "score": {
    "overall": <điểm tổng hợp 0-100>,
    "dimensions": {
      "market": <điểm thị trường 0-100, dựa trên CEO + marketing reports>,
      "competition": <điểm cạnh tranh 0-100, dựa trên SWOT trong CEO report>,
      "finance": <điểm tài chính 0-100, dựa trên accountant report>,
      "legal": <điểm pháp lý 0-100, dựa trên legal report nếu có>,
      "marketing": <điểm marketing 0-100, dựa trên marketing report>
    },
    "risks": [<top 4 rủi ro cụ thể, mỗi rủi ro 1 câu ngắn tiếng Việt>],
    "opportunities": [<top 4 cơ hội cụ thể, mỗi cơ hội 1 câu ngắn tiếng Việt>]
  },
  "investorSummary": "<2-3 đoạn văn tiếng Việt cho nhà đầu tư, chuyên nghiệp, có số liệu cụ thể>"
}

Lưu ý:
- Nếu không tìm thấy số liệu chính xác, hãy ước tính dựa trên ngành và quy mô doanh nghiệp
- overall = trung bình có trọng số của 5 dimensions (market*0.25 + competition*0.20 + finance*0.25 + legal*0.15 + marketing*0.15)
- Tất cả điểm số từ 0-100
- investorSummary phải có số liệu tài chính cụ thể và lý do đầu tư rõ ràng`;

  try {
    const resp = await openai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const raw = resp.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.error({ raw }, "Executive generate: failed to parse AI JSON");
      res.status(500).json({ error: "AI trả về JSON không hợp lệ" });
      return;
    }

    const kpis = parsed.kpis as ExecutiveData["kpis"];
    const scoreRaw = parsed.score as { overall: number; dimensions: DimensionScores; risks: string[]; opportunities: string[] };
    const overall = Math.min(100, Math.max(0, Math.round(scoreRaw?.overall ?? 70)));
    const score: BusinessScore = {
      overall,
      level: scoreLevel(overall),
      dimensions: {
        market: Math.min(100, Math.max(0, Math.round(scoreRaw?.dimensions?.market ?? 70))),
        competition: Math.min(100, Math.max(0, Math.round(scoreRaw?.dimensions?.competition ?? 65))),
        finance: Math.min(100, Math.max(0, Math.round(scoreRaw?.dimensions?.finance ?? 70))),
        legal: Math.min(100, Math.max(0, Math.round(scoreRaw?.dimensions?.legal ?? 65))),
        marketing: Math.min(100, Math.max(0, Math.round(scoreRaw?.dimensions?.marketing ?? 75))),
      },
      risks: Array.isArray(scoreRaw?.risks) ? scoreRaw.risks.slice(0, 4) : [],
      opportunities: Array.isArray(scoreRaw?.opportunities) ? scoreRaw.opportunities.slice(0, 4) : [],
    };

    const executive: ExecutiveData = {
      kpis,
      score,
      investorSummary: String(parsed.investorSummary ?? ""),
      generatedAt: new Date().toISOString(),
    };

    await saveExecutiveData(projectId, executive);
    logger.info({ projectId, overall: score.overall }, "Executive data generated and cached");
    res.json(executive);
  } catch (err) {
    logger.error({ err, projectId }, "Executive generate failed");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
