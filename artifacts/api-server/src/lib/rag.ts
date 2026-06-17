import { eq } from "drizzle-orm";
import { db, projectsTable, agentTasksTable, knowledgeBaseTable } from "@workspace/db";
import { buildMemoryContext } from "./memory";

export async function buildProjectContext(projectId: number): Promise<string> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));

  if (!project) return "";

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.projectId, projectId));

  const kbEntries = await db
    .select()
    .from(knowledgeBaseTable)
    .where(eq(knowledgeBaseTable.projectId, projectId));

  const completedTasks = tasks.filter((t) => t.status === "completed" && t.output);

  const agentSections = completedTasks
    .map((t) => {
      const label =
        t.agentType === "ceo"
          ? "PHÂN TÍCH THỊ TRƯỜNG (AI CEO)"
          : t.agentType === "marketing"
          ? "KẾ HOẠCH MARKETING (AI Marketing)"
          : t.agentType === "sales"
          ? "SALES PLAYBOOK (AI Sales)"
          : t.agentName.toUpperCase();
      return `===== ${label} =====\n${t.output}`;
    })
    .join("\n\n");

  const kbSections = kbEntries
    .map((e) => `[${e.title}]\n${e.content}`)
    .join("\n\n");

  const parts: string[] = [
    `===== THÔNG TIN DỰ ÁN =====`,
    `Tên dự án: ${project.name}`,
    `Ý tưởng kinh doanh: ${project.businessIdea}`,
    project.industry ? `Ngành nghề: ${project.industry}` : null,
    project.targetMarket ? `Thị trường mục tiêu: ${project.targetMarket}` : null,
    `Trạng thái: ${project.status} (${project.completionPercent}% hoàn thành)`,
  ].filter(Boolean) as string[];

  if (agentSections) {
    parts.push("\n" + agentSections);
  }

  if (kbSections) {
    parts.push(`\n===== KNOWLEDGE BASE =====\n${kbSections}`);
  }

  // Inject project memory (CEO report, marketing plan, sales playbook, chat history)
  const memoryContext = await buildMemoryContext(projectId);
  if (memoryContext) {
    parts.push(`\n===== PROJECT MEMORY =====\n${memoryContext}`);
  }

  return parts.join("\n");
}

export async function syncTaskToKnowledgeBase(
  projectId: number,
  agentType: string,
  agentName: string,
  output: string
): Promise<void> {
  const titleMap: Record<string, string> = {
    ceo: "Phân Tích Thị Trường (AI CEO)",
    marketing: "Kế Hoạch Marketing (AI Marketing)",
    sales: "Sales Playbook (AI Sales)",
  };
  const title = titleMap[agentType] ?? agentName;

  const existing = await db
    .select()
    .from(knowledgeBaseTable)
    .where(eq(knowledgeBaseTable.projectId, projectId))
    .then((rows) => rows.find((r) => r.title === title));

  if (existing) {
    await db
      .update(knowledgeBaseTable)
      .set({ content: output, updatedAt: new Date() })
      .where(eq(knowledgeBaseTable.id, existing.id));
  } else {
    await db.insert(knowledgeBaseTable).values({
      projectId,
      title,
      content: output,
    });
  }
}
