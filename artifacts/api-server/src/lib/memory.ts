/**
 * Project Memory Service
 *
 * Stores and retrieves structured memory per project.
 * Designed so the storage layer can be swapped for a
 * Vector Database (e.g. pgvector, Pinecone) in the future
 * without changing the call-sites — just replace these functions.
 *
 * Types:
 *   ceo_report     — AI CEO market analysis output
 *   marketing_plan — AI Marketing plan output
 *   sales_playbook — AI Sales playbook output
 *   chat_history   — compressed summary of recent chat turns
 */

import { eq, and, desc } from "drizzle-orm";
import { db, projectMemoryTable } from "@workspace/db";
import type { MemoryType } from "@workspace/db";

/**
 * Save (upsert) a memory entry for a project.
 * Only one entry per (projectId, type) is kept — newer overwrites older.
 * For chat_history, multiple entries are allowed (one per conversation).
 */
export async function saveMemory(
  projectId: number,
  type: MemoryType,
  content: string
): Promise<void> {
  if (type === "chat_history") {
    await db.insert(projectMemoryTable).values({ projectId, type, content });
    return;
  }

  const [existing] = await db
    .select({ id: projectMemoryTable.id })
    .from(projectMemoryTable)
    .where(
      and(
        eq(projectMemoryTable.projectId, projectId),
        eq(projectMemoryTable.type, type)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(projectMemoryTable)
      .set({ content, createdAt: new Date() })
      .where(eq(projectMemoryTable.id, existing.id));
  } else {
    await db.insert(projectMemoryTable).values({ projectId, type, content });
  }
}

/**
 * Retrieve all memory entries for a project, ordered newest-first.
 * Optionally filter by type.
 *
 * Future: replace with vector similarity search against a query string.
 */
export async function getMemory(
  projectId: number,
  type?: MemoryType
): Promise<Array<{ id: number; type: MemoryType; content: string; createdAt: Date }>> {
  const conditions = type
    ? and(
        eq(projectMemoryTable.projectId, projectId),
        eq(projectMemoryTable.type, type)
      )
    : eq(projectMemoryTable.projectId, projectId);

  return db
    .select()
    .from(projectMemoryTable)
    .where(conditions)
    .orderBy(desc(projectMemoryTable.createdAt));
}

/**
 * Build a formatted memory block suitable for injection into a system prompt.
 * Returns empty string if no memories exist.
 *
 * Future: this is the function to swap for semantic retrieval —
 * pass `query` to find the most relevant chunks via vector search.
 */
export async function buildMemoryContext(
  projectId: number,
  _query?: string
): Promise<string> {
  const entries = await getMemory(projectId);
  if (entries.length === 0) return "";

  const LABELS: Record<MemoryType, string> = {
    ceo_report: "BÁO CÁO CEO (AI CEO)",
    marketing_plan: "KẾ HOẠCH MARKETING (AI Marketing)",
    sales_playbook: "SALES PLAYBOOK (AI Sales)",
    chat_history: "LỊCH SỬ CHAT",
  };

  const structured: Record<string, string[]> = {};
  for (const e of entries) {
    const label = LABELS[e.type] ?? e.type;
    if (!structured[label]) structured[label] = [];
    structured[label].push(e.content);
  }

  const sections = Object.entries(structured)
    .map(([label, contents]) => {
      const body =
        label === LABELS.chat_history
          ? contents.slice(0, 5).join("\n---\n")
          : contents[0];
      return `===== ${label} =====\n${body}`;
    })
    .join("\n\n");

  return sections;
}

/** Delete all memories for a project (e.g. on project reset). */
export async function clearMemory(projectId: number): Promise<void> {
  await db
    .delete(projectMemoryTable)
    .where(eq(projectMemoryTable.projectId, projectId));
}
