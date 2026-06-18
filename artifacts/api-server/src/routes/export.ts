import { Router, type IRouter } from "express";
import { createRequire } from "module";
import { eq } from "drizzle-orm";
import { db, projectsTable, agentTasksTable } from "@workspace/db";
import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
} from "docx";

const _require = createRequire(import.meta.url);
const vfsFontsData = _require("pdfmake/build/vfs_fonts");
const vfs: Record<string, string> = vfsFontsData.pdfMake?.vfs ?? vfsFontsData;

const router: IRouter = Router();

const AGENT_ORDER = ["ceo", "marketing", "sales", "cskh", "hr", "accountant", "legal"];

const AGENT_LABELS: Record<string, string> = {
  ceo: "AI CEO — Phân Tích Thị Trường & Chiến Lược",
  marketing: "AI Marketing — Kế Hoạch Marketing",
  sales: "AI Sales — Chiến Lược Bán Hàng",
  cskh: "AI CSKH — Dịch Vụ Khách Hàng",
  hr: "AI HR — Nhân Sự & Tổ Chức",
  accountant: "AI Kế Toán — Tài Chính & Ngân Sách",
  legal: "AI Pháp Lý — Khung Pháp Lý",
};

const ACCENT_HEX: Record<string, string> = {
  ceo: "#06b6d4",
  marketing: "#d946ef",
  sales: "#22c55e",
  cskh: "#f59e0b",
  hr: "#3b82f6",
  accountant: "#10b981",
  legal: "#8b5cf6",
};

type ProjectData = {
  project: typeof projectsTable.$inferSelect;
  orderedTasks: Array<typeof agentTasksTable.$inferSelect>;
  completedCount: number;
};

async function fetchProjectData(id: number): Promise<ProjectData | null> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) return null;

  const tasks = await db.select().from(agentTasksTable).where(eq(agentTasksTable.projectId, id));
  const completed = tasks.filter((t) => t.status === "completed" && t.output);
  const orderedTasks = AGENT_ORDER.map((type) =>
    completed.find((t) => t.agentType === type)
  ).filter(Boolean) as typeof completed;

  return { project, orderedTasks, completedCount: completed.length };
}

function formatDate(): string {
  return new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ─── MARKDOWN BUILDER ─────────────────────────────────────────────────────────

function buildMarkdown(data: ProjectData): string {
  const { project, orderedTasks, completedCount } = data;
  const date = formatDate();

  const lines: string[] = [
    `# AI COMPANY-IN-A-BOX`,
    `## Kế Hoạch Kinh Doanh: ${project.name}`,
    ``,
    `**Ngày xuất:** ${date}  `,
    `**Trạng thái:** ${completedCount}/7 agents hoàn thành`,
    ``,
    `---`,
    ``,
    `## Thông Tin Dự Án`,
    ``,
    `- **Tên dự án:** ${project.name}`,
    `- **Ý tưởng kinh doanh:** ${project.businessIdea}`,
    ...(project.industry ? [`- **Ngành nghề:** ${project.industry}`] : []),
    ...(project.targetMarket ? [`- **Thị trường mục tiêu:** ${project.targetMarket}`] : []),
    ``,
    `---`,
  ];

  for (const task of orderedTasks) {
    const label = AGENT_LABELS[task.agentType] ?? task.agentName;
    lines.push(``, `## ${label}`, ``, task.output ?? "", ``, `---`);
  }

  if (orderedTasks.length === 0) {
    lines.push(``, `*Chưa có agent nào hoàn thành. Vui lòng chạy các AI agents trước khi xuất.*`, ``);
  }

  lines.push(``, `*Được tạo bởi AI Company-in-a-Box · ${date}*`);
  return lines.join("\n");
}

// ─── PDF BUILDER (pdfkit) ─────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [
    parseInt(c.substring(0, 2), 16),
    parseInt(c.substring(2, 4), 16),
    parseInt(c.substring(4, 6), 16),
  ];
}

function stripMarkdownLine(line: string): string {
  return line
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

async function buildPdf(data: ProjectData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { project, orderedTasks } = data;
    const date = formatDate();

    const robotoNormal = Buffer.from(vfs["Roboto-Regular.ttf"], "base64");
    const robotoBold = Buffer.from(vfs["Roboto-Medium.ttf"], "base64");

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 60, left: 50, right: 50 },
      info: {
        Title: `Kế Hoạch Kinh Doanh - ${project.name}`,
        Author: "AI Company-in-a-Box",
      },
    });

    doc.registerFont("Roboto", robotoNormal);
    doc.registerFont("Roboto-Bold", robotoBold);

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PAGE_W = 595 - 100; // A4 width - margins
    const MARGIN_L = 50;

    // ── Cover header ──────────────────────────────────────────────────────────
    doc.rect(MARGIN_L, 40, PAGE_W, 90).fill("#0f172a");
    // Cyan top line
    doc.rect(MARGIN_L, 40, PAGE_W, 3).fill("#06b6d4");

    doc
      .font("Roboto-Bold")
      .fontSize(7)
      .fillColor("#06b6d4")
      .text("AI COMPANY-IN-A-BOX", MARGIN_L + 14, 56, { characterSpacing: 2 });

    doc
      .font("Roboto-Bold")
      .fontSize(20)
      .fillColor("#ffffff")
      .text(project.name, MARGIN_L + 14, 68);

    doc
      .font("Roboto")
      .fontSize(8)
      .fillColor("#64748b")
      .text(`Kế hoạch kinh doanh toàn diện · ${date}`, MARGIN_L + 14, 96);

    // Agent count badge
    doc
      .font("Roboto-Bold")
      .fontSize(26)
      .fillColor("#06b6d4")
      .text(`${orderedTasks.length}/7`, MARGIN_L + PAGE_W - 60, 55, { width: 60, align: "right" });

    doc
      .font("Roboto")
      .fontSize(7)
      .fillColor("#64748b")
      .text("agents hoàn thành", MARGIN_L + PAGE_W - 80, 84, { width: 80, align: "right" });

    // ── Project info block ───────────────────────────────────────────────────
    let y = 150;

    doc.rect(MARGIN_L, y, PAGE_W, 1).fill("#1e293b");
    y += 10;

    doc.font("Roboto-Bold").fontSize(7).fillColor("#475569");
    doc.text("Ý TƯỞNG KINH DOANH", MARGIN_L, y, { characterSpacing: 1.5 });
    y += 14;

    doc.font("Roboto").fontSize(9.5).fillColor("#94a3b8");
    const ideaHeight = doc.heightOfString(project.businessIdea, { width: PAGE_W });
    doc.text(project.businessIdea, MARGIN_L, y, { width: PAGE_W });
    y += ideaHeight + 10;

    const metaItems: Array<[string, string]> = [];
    if (project.industry) metaItems.push(["NGÀNH", project.industry]);
    if (project.targetMarket) metaItems.push(["THỊ TRƯỜNG MỤC TIÊU", project.targetMarket]);
    if (metaItems.length > 0) {
      const colW = PAGE_W / metaItems.length;
      for (let i = 0; i < metaItems.length; i++) {
        const [label, value] = metaItems[i];
        doc.font("Roboto-Bold").fontSize(7).fillColor("#475569").text(label, MARGIN_L + i * colW, y, { characterSpacing: 1 });
        doc.font("Roboto").fontSize(9).fillColor("#cbd5e1").text(value, MARGIN_L + i * colW, y + 12, { width: colW - 10 });
      }
      y += 34;
    }

    doc.rect(MARGIN_L, y, PAGE_W, 1).fill("#1e293b");
    y += 20;

    // ── Agent sections ───────────────────────────────────────────────────────
    if (orderedTasks.length === 0) {
      doc
        .font("Roboto")
        .fontSize(11)
        .fillColor("#64748b")
        .text(
          "Chưa có agent nào hoàn thành. Vui lòng chạy các AI agents trước khi xuất PDF.",
          MARGIN_L,
          y + 60,
          { width: PAGE_W, align: "center" }
        );
    }

    for (const task of orderedTasks) {
      const accentColor = ACCENT_HEX[task.agentType] ?? "#06b6d4";
      const label = AGENT_LABELS[task.agentType] ?? task.agentName;
      const [ar, ag, ab] = hexToRgb(accentColor);

      // Check if we need a new page (leave 80px buffer)
      if (y > doc.page.height - 160) {
        doc.addPage();
        y = 50;
      }

      // Section header bar
      doc.rect(MARGIN_L, y, PAGE_W, 26).fill("#0f172a");
      doc.rect(MARGIN_L, y, 3, 26).fill(accentColor);

      doc
        .font("Roboto-Bold")
        .fontSize(10)
        .fillColor(accentColor)
        .text(label, MARGIN_L + 12, y + 8);

      y += 34;

      // Section content — parse markdown lines
      const lines = (task.output ?? "").split("\n");
      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          y += 4;
          continue;
        }

        // New page check
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 50;
        }

        if (/^#{1,3}\s/.test(trimmed)) {
          // Heading
          const level = (trimmed.match(/^#+/) ?? [""])[0].length;
          const text = stripMarkdownLine(trimmed.replace(/^#+\s+/, ""));
          const fontSize = level === 1 ? 11 : level === 2 ? 10 : 9.5;
          doc
            .font("Roboto-Bold")
            .fontSize(fontSize)
            .fillColor(`rgb(${ar},${ag},${ab})`)
            .text(text, MARGIN_L, y, { width: PAGE_W });
          y += doc.heightOfString(text, { width: PAGE_W }) + (level === 1 ? 6 : 3);
        } else if (/^[-*•]\s/.test(trimmed)) {
          // Bullet point
          const text = stripMarkdownLine(trimmed.replace(/^[-*•]\s+/, ""));
          const bullet = "•  " + text;
          doc
            .font("Roboto")
            .fontSize(8.5)
            .fillColor("#cbd5e1")
            .text(bullet, MARGIN_L + 10, y, { width: PAGE_W - 10 });
          y += doc.heightOfString(bullet, { width: PAGE_W - 10 }) + 2;
        } else if (trimmed === "---") {
          doc.rect(MARGIN_L, y + 2, PAGE_W, 0.5).fill("#1e293b");
          y += 8;
        } else {
          // Normal paragraph
          const text = stripMarkdownLine(trimmed);
          if (!text) continue;
          doc
            .font("Roboto")
            .fontSize(8.5)
            .fillColor("#e2e8f0")
            .text(text, MARGIN_L, y, { width: PAGE_W });
          y += doc.heightOfString(text, { width: PAGE_W }) + 3;
        }
      }

      // Section bottom divider
      y += 8;
      doc.rect(MARGIN_L, y, PAGE_W, 0.5).fill("#1e293b");
      y += 18;
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = 50;
    }
    y += 20;
    doc
      .font("Roboto")
      .fontSize(7)
      .fillColor("#334155")
      .text(`Được tạo bởi AI Company-in-a-Box · ${date}`, MARGIN_L, y, { width: PAGE_W, align: "center" });

    doc.end();
  });
}

// ─── DOCX BUILDER ─────────────────────────────────────────────────────────────

function parseMarkdownLine(text: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return new TextRun({ text: part.slice(2, -2), bold: true, size: 20 });
      }
      return new TextRun({ text: part, size: 20 });
    });
}

function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const result: Paragraph[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      result.push(new Paragraph({ text: "", spacing: { after: 80 } }));
      continue;
    }

    if (/^#{3}\s/.test(trimmed)) {
      result.push(new Paragraph({ text: trimmed.replace(/^###\s+/, ""), heading: HeadingLevel.HEADING_3 }));
    } else if (/^#{2}\s/.test(trimmed)) {
      result.push(new Paragraph({ text: trimmed.replace(/^##\s+/, ""), heading: HeadingLevel.HEADING_2 }));
    } else if (/^#{1}\s/.test(trimmed)) {
      result.push(new Paragraph({ text: trimmed.replace(/^#\s+/, ""), heading: HeadingLevel.HEADING_1 }));
    } else if (/^[-*•]\s/.test(trimmed)) {
      result.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseMarkdownLine(trimmed.replace(/^[-*•]\s+/, "")),
        })
      );
    } else if (trimmed === "---") {
      result.push(
        new Paragraph({
          text: "",
          border: { bottom: { color: "CCCCCC", style: BorderStyle.SINGLE, size: 6 } },
          spacing: { before: 120, after: 120 },
        })
      );
    } else {
      result.push(new Paragraph({ children: parseMarkdownLine(trimmed), spacing: { after: 80 } }));
    }
  }
  return result;
}

async function buildDocx(data: ProjectData): Promise<Buffer> {
  const { project, orderedTasks, completedCount } = data;
  const date = formatDate();

  const coverChildren: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: "AI COMPANY-IN-A-BOX", bold: true, size: 36, color: "06B6D4" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: project.name, bold: true, size: 52 })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Kế Hoạch Kinh Doanh Toàn Diện", size: 28, color: "64748B" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        right: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        insideH: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
        insideV: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
      },
      rows: (
        [
          ["Ý tưởng kinh doanh", project.businessIdea],
          project.industry ? ["Ngành nghề", project.industry] : null,
          project.targetMarket ? ["Thị trường mục tiêu", project.targetMarket] : null,
          ["Ngày xuất báo cáo", date],
          ["Agents hoàn thành", `${completedCount}/7`],
        ].filter(Boolean) as [string, string][]
      ).map(
        ([label, value]) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 30, type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.SOLID, color: "F1F5F9" },
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18 })] })],
              }),
              new TableCell({
                width: { size: 70, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: value, size: 18 })] })],
              }),
            ],
          })
      ),
    }) as unknown as Paragraph,
    new Paragraph({ text: "", spacing: { after: 400 } }),
  ];

  const agentParagraphs: Paragraph[] = [];
  for (const task of orderedTasks) {
    const label = AGENT_LABELS[task.agentType] ?? task.agentName;
    agentParagraphs.push(
      new Paragraph({ text: label, heading: HeadingLevel.HEADING_1, spacing: { before: 480, after: 240 } })
    );
    agentParagraphs.push(...markdownToDocxParagraphs(task.output ?? ""));
  }

  if (agentParagraphs.length === 0) {
    agentParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Chưa có agent nào hoàn thành. Vui lòng chạy các AI agents trước khi xuất.",
            italics: true,
            color: "64748B",
          }),
        ],
      })
    );
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 20 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { bold: true, size: 28, color: "0F172A" }, paragraph: { spacing: { before: 360, after: 180 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { bold: true, size: 24, color: "1E293B" }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { bold: true, size: 22, color: "334155" }, paragraph: { spacing: { before: 180, after: 80 } } },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 } } },
        children: [
          ...coverChildren,
          ...agentParagraphs,
          new Paragraph({
            children: [
              new TextRun({ text: `Được tạo bởi AI Company-in-a-Box · ${date}`, italics: true, color: "94A3B8", size: 18 }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 480 },
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

router.get("/projects/:id/export/markdown", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const data = await fetchProjectData(id);
  if (!data) { res.status(404).json({ error: "Project not found" }); return; }

  const markdown = buildMarkdown(data);
  const safeName = data.project.name.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").trim().replace(/\s+/g, "_");
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="business-plan-${id}_${safeName}.md"`);
  res.send(markdown);
});

router.get("/projects/:id/export/pdf", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const data = await fetchProjectData(id);
  if (!data) { res.status(404).json({ error: "Project not found" }); return; }

  try {
    const pdfBuffer = await buildPdf(data);
    const safeName = data.project.name.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").trim().replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="business-plan-${id}_${safeName}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/projects/:id/export/docx", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const data = await fetchProjectData(id);
  if (!data) { res.status(404).json({ error: "Project not found" }); return; }

  try {
    const buffer = await buildDocx(data);
    const safeName = data.project.name.replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, "").trim().replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="business-plan-${id}_${safeName}.docx"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
