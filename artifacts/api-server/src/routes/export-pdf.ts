import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, agentTasksTable } from "@workspace/db";
import pdfmakeLib from "pdfmake";
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";

// pdfmake ships CJS; when loaded via ESM interop the constructor lives on .default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PdfPrinter: typeof pdfmakeLib = (pdfmakeLib as any).default ?? pdfmakeLib;

const router: IRouter = Router();

const AGENT_LABELS: Record<string, string> = {
  ceo: "AI CEO — Phân Tích Thị Trường & Chiến Lược",
  marketing: "AI Marketing — Kế Hoạch Marketing",
  sales: "AI Sales — Chiến Lược Bán Hàng",
  cskh: "AI CSKH — Dịch Vụ Khách Hàng",
  hr: "AI HR — Nhân Sự & Tổ Chức",
  accountant: "AI Kế Toán — Tài Chính & Ngân Sách",
  legal: "AI Pháp Lý — Khung Pháp Lý",
};

const AGENT_ORDER = ["ceo", "marketing", "sales", "cskh", "hr", "accountant", "legal"];

const ACCENT_COLORS: Record<string, string> = {
  ceo: "#06b6d4",
  marketing: "#d946ef",
  sales: "#22c55e",
  cskh: "#f59e0b",
  hr: "#3b82f6",
  accountant: "#10b981",
  legal: "#8b5cf6",
};

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, (m) => m.trim() + " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildSectionContent(agentType: string, output: string): Content[] {
  const color = ACCENT_COLORS[agentType] || "#06b6d4";
  const label = AGENT_LABELS[agentType] || agentType.toUpperCase();

  const lines = stripMarkdown(output)
    .split("\n")
    .filter((l) => l.trim().length > 0);

  const paragraphs: Content[] = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("• ")) {
      return {
        text: trimmed,
        fontSize: 9,
        color: "#cbd5e1",
        margin: [16, 2, 0, 2],
      } as Content;
    }
    return {
      text: trimmed,
      fontSize: 9,
      color: "#e2e8f0",
      margin: [0, 3, 0, 3],
    } as Content;
  });

  return [
    {
      canvas: [
        {
          type: "rect",
          x: 0,
          y: 0,
          w: 515,
          h: 28,
          color: "#0f172a",
          r: 4,
        },
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: 0,
          y2: 28,
          lineWidth: 3,
          lineColor: color,
        },
      ],
      margin: [0, 20, 0, 0],
    } as Content,
    {
      text: label,
      fontSize: 11,
      bold: true,
      color: color,
      margin: [10, -22, 0, 14],
    } as Content,
    ...paragraphs,
    {
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: 515,
          y2: 0,
          lineWidth: 0.5,
          lineColor: "#1e293b",
        },
      ],
      margin: [0, 10, 0, 0],
    } as Content,
  ];
}

// GET /api/projects/:id/export-pdf
router.get("/projects/:id/export-pdf", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, id));

  const completedTasks = tasks.filter((t) => t.status === "completed" && t.output);
  const orderedTasks = AGENT_ORDER.map((type) =>
    completedTasks.find((t) => t.agentType === type)
  ).filter(Boolean) as typeof completedTasks;

  const now = new Date().toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const agentSections: Content[] = orderedTasks.flatMap((task) =>
    buildSectionContent(task.agentType, task.output!)
  );

  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 60, 40, 60],
    background: () => ({
      canvas: [
        {
          type: "rect",
          x: 0,
          y: 0,
          w: 595,
          h: 842,
          color: "#020617",
        },
      ],
    }),
    defaultStyle: {
      font: "Roboto",
      color: "#e2e8f0",
    },
    content: [
      // Header bar
      {
        canvas: [
          {
            type: "rect",
            x: 0,
            y: 0,
            w: 515,
            h: 80,
            color: "#0f172a",
            r: 6,
          },
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 515,
            y2: 0,
            lineWidth: 2,
            lineColor: "#06b6d4",
          },
        ],
        margin: [0, 0, 0, 0],
      },
      {
        columns: [
          {
            stack: [
              {
                text: "AI COMPANY-IN-A-BOX",
                fontSize: 8,
                bold: true,
                color: "#06b6d4",
                characterSpacing: 2,
                margin: [12, -74, 0, 4],
              },
              {
                text: project.name,
                fontSize: 22,
                bold: true,
                color: "#ffffff",
                margin: [12, 0, 0, 4],
              },
              {
                text: `Kế hoạch kinh doanh toàn diện · ${now}`,
                fontSize: 8,
                color: "#64748b",
                margin: [12, 0, 0, 0],
              },
            ],
          },
          {
            stack: [
              {
                text: `${orderedTasks.length}/7`,
                fontSize: 28,
                bold: true,
                color: "#06b6d4",
                alignment: "right",
                margin: [0, -70, 8, 2],
              },
              {
                text: "agents hoàn thành",
                fontSize: 8,
                color: "#64748b",
                alignment: "right",
                margin: [0, 0, 8, 0],
              },
            ],
          },
        ],
        margin: [0, 0, 0, 16],
      },
      // Business idea block
      {
        stack: [
          {
            text: "Ý TƯỞNG KINH DOANH",
            fontSize: 7,
            bold: true,
            color: "#475569",
            characterSpacing: 2,
            margin: [0, 0, 0, 4],
          },
          {
            text: project.businessIdea,
            fontSize: 10,
            color: "#94a3b8",
            italics: true,
          },
          ...(project.industry || project.targetMarket
            ? [
                {
                  columns: [
                    project.industry
                      ? {
                          stack: [
                            { text: "NGÀNH", fontSize: 7, color: "#475569", bold: true, characterSpacing: 1 },
                            { text: project.industry, fontSize: 9, color: "#cbd5e1" },
                          ],
                        }
                      : {},
                    project.targetMarket
                      ? {
                          stack: [
                            { text: "THỊ TRƯỜNG MỤC TIÊU", fontSize: 7, color: "#475569", bold: true, characterSpacing: 1 },
                            { text: project.targetMarket, fontSize: 9, color: "#cbd5e1" },
                          ],
                        }
                      : {},
                  ],
                  margin: [0, 10, 0, 0],
                } as Content,
              ]
            : []),
        ],
        margin: [0, 0, 0, 10],
        padding: [14, 12],
      } as Content,

      completedTasks.length === 0
        ? ({
            text: "Chưa có agent nào hoàn thành. Vui lòng chạy các AI agents trước khi xuất PDF.",
            fontSize: 11,
            color: "#64748b",
            italics: true,
            alignment: "center",
            margin: [0, 60, 0, 0],
          } as Content)
        : agentSections,

      // Footer
      {
        text: `Được tạo bởi AI Company-in-a-Box · ${now}`,
        fontSize: 7,
        color: "#334155",
        alignment: "center",
        margin: [0, 30, 0, 0],
      } as Content,
    ],
  };

  const printer = new PdfPrinter({
    Roboto: {
      normal: "node_modules/pdfmake/build/vfs_fonts.js",
      bold: "node_modules/pdfmake/build/vfs_fonts.js",
      italics: "node_modules/pdfmake/build/vfs_fonts.js",
      bolditalics: "node_modules/pdfmake/build/vfs_fonts.js",
    },
  });

  const chunks: Buffer[] = [];
  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));
  pdfDoc.on("end", () => {
    const result = Buffer.concat(chunks);
    const safeName = project.name.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").trim().replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_KeHoachKinhDoanh.pdf"`);
    res.setHeader("Content-Length", result.length);
    res.send(result);
  });
  pdfDoc.on("error", (err: Error) => {
    res.status(500).json({ error: err.message });
  });
  pdfDoc.end();
});

export default router;
