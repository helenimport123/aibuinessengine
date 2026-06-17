import { jsPDF } from "jspdf";

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

const ACCENT_RGB: Record<string, [number, number, number]> = {
  ceo: [6, 182, 212],
  marketing: [217, 70, 239],
  sales: [34, 197, 94],
  cskh: [245, 158, 11],
  hr: [59, 130, 246],
  accountant: [16, 185, 129],
  legal: [139, 92, 246],
};

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Task = {
  agentType: string;
  status: string;
  output?: string | null;
};

type Project = {
  name: string;
  businessIdea: string;
  industry?: string | null;
  targetMarket?: string | null;
  completionPercent: number;
  tasks: Task[];
};

export function generateBusinessPlanPdf(project: Project): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;

  const now = new Date().toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const completedTasks = AGENT_ORDER.map((type) =>
    project.tasks.find((t) => t.agentType === type && t.status === "completed" && t.output)
  ).filter(Boolean) as Task[];

  let y = 0;

  function newPage() {
    doc.addPage();
    y = margin;
    // subtle page bg
    doc.setFillColor(2, 6, 23);
    doc.rect(0, 0, pageW, pageH, "F");
  }

  function ensureSpace(needed: number) {
    if (y + needed > pageH - margin) newPage();
  }

  function addWrappedText(
    text: string,
    x: number,
    startY: number,
    maxW: number,
    fontSize: number,
    r: number,
    g: number,
    b: number,
    lineSpacing = 1.4
  ): number {
    doc.setFontSize(fontSize);
    doc.setTextColor(r, g, b);
    const lines = doc.splitTextToSize(text, maxW) as string[];
    const lineH = (fontSize / 2.835) * lineSpacing;
    for (const line of lines) {
      ensureSpace(lineH + 2);
      doc.text(line, x, y);
      y += lineH;
    }
    return y;
  }

  // ── Cover page background ──────────────────────────────────────────────────
  doc.setFillColor(2, 6, 23);
  doc.rect(0, 0, pageW, pageH, "F");

  // Top cyan accent bar
  doc.setFillColor(6, 182, 212);
  doc.rect(0, 0, pageW, 1.2, "F");

  y = 28;

  // Badge
  doc.setFillColor(6, 26, 46);
  doc.roundedRect(margin, y - 5, 58, 8, 2, 2, "F");
  doc.setFontSize(7);
  doc.setTextColor(6, 182, 212);
  doc.text("AI COMPANY-IN-A-BOX", margin + 4, y);
  y += 10;

  // Project name
  doc.setFontSize(26);
  doc.setTextColor(255, 255, 255);
  const nameLines = doc.splitTextToSize(project.name, contentW) as string[];
  for (const line of nameLines) {
    doc.text(line, margin, y);
    y += 10;
  }

  // Sub-headline
  y += 2;
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Kế hoạch kinh doanh toàn diện · ${now}`, margin, y);
  y += 14;

  // Separator
  doc.setDrawColor(30, 41, 59);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  // Business idea block
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, y, contentW, 28, 3, 3, "F");
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  doc.text("Ý TƯỞNG KINH DOANH", margin + 4, y + 7);
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  const ideaLines = doc.splitTextToSize(project.businessIdea, contentW - 8) as string[];
  let iy = y + 13;
  for (const line of ideaLines.slice(0, 2)) {
    doc.text(line, margin + 4, iy);
    iy += 5;
  }
  y += 34;

  // Industry / Market tags
  if (project.industry || project.targetMarket) {
    const tags = [
      project.industry ? `IND: ${project.industry}` : null,
      project.targetMarket ? `MKT: ${project.targetMarket}` : null,
    ].filter(Boolean) as string[];
    let tx = margin;
    for (const tag of tags) {
      doc.setFillColor(15, 23, 42);
      const tw = doc.getTextWidth(tag) + 8;
      doc.roundedRect(tx, y, tw, 7, 1.5, 1.5, "F");
      doc.setDrawColor(30, 41, 59);
      doc.setLineWidth(0.3);
      doc.roundedRect(tx, y, tw, 7, 1.5, 1.5, "S");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(tag, tx + 4, y + 4.8);
      tx += tw + 4;
    }
    y += 14;
  }

  // Stats row
  y += 4;
  const stats = [
    { label: "AGENTS HOÀN THÀNH", value: `${completedTasks.length}/7`, color: [6, 182, 212] as [number,number,number] },
    { label: "MỨC ĐỘ HOÀN THÀNH", value: `${project.completionPercent}%`, color: [34, 197, 94] as [number,number,number] },
  ];
  const statW = (contentW - 8) / stats.length;
  stats.forEach((stat, i) => {
    const sx = margin + i * (statW + 8);
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(sx, y, statW, 18, 3, 3, "F");
    doc.setFillColor(...stat.color);
    doc.rect(sx, y, 2.5, 18, "F");
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(stat.label, sx + 7, y + 6);
    doc.setFontSize(16);
    doc.setTextColor(...stat.color);
    doc.text(stat.value, sx + 7, y + 14);
  });
  y += 26;

  // ── Agent sections ─────────────────────────────────────────────────────────
  if (completedTasks.length === 0) {
    y += 30;
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    const noDataLines = doc.splitTextToSize(
      "Chưa có agent nào hoàn thành. Vui lòng chạy các AI agents trước khi xuất PDF.",
      contentW
    ) as string[];
    for (const line of noDataLines) {
      doc.text(line, pageW / 2, y, { align: "center" });
      y += 6;
    }
  } else {
    for (const task of completedTasks) {
      const [r, g, b] = ACCENT_RGB[task.agentType] || [6, 182, 212];
      const label = AGENT_LABELS[task.agentType] || task.agentType.toUpperCase();

      // Section header — ensure space for it
      ensureSpace(22);

      // Header bar
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(margin, y, contentW, 12, 2, 2, "F");
      doc.setFillColor(r, g, b);
      doc.rect(margin, y, 2.5, 12, "F");
      doc.setFontSize(9);
      doc.setTextColor(r, g, b);
      doc.text(label, margin + 7, y + 8);
      y += 18;

      // Content
      const cleaned = stripMarkdown(task.output!);
      addWrappedText(cleaned, margin + 3, y, contentW - 3, 8.5, 203, 213, 225);
      y += 6;

      // Divider
      ensureSpace(4);
      doc.setDrawColor(30, 41, 59);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageW - margin, y);
      y += 8;
    }
  }

  // ── Page numbers ───────────────────────────────────────────────────────────
  const totalPages = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `AI Company-in-a-Box · ${project.name} · Trang ${i}/${totalPages}`,
      pageW / 2,
      pageH - 8,
      { align: "center" }
    );
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
  }

  const safeName = project.name.replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_");
  doc.save(`${safeName}_KeHoachKinhDoanh.pdf`);
}
