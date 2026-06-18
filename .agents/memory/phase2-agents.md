---
name: Phase 2 — 7 Agent Architecture
description: All 7 agents fully wired end-to-end: prompts, frontend configs, memory types, CEO orchestration, streaming, PostgreSQL storage.
---

## Agents
| Key | Name | Memory Type | Color |
|-----|------|-------------|-------|
| ceo | AI CEO | ceo_report | cyan |
| marketing | AI Marketing | marketing_plan | fuchsia |
| sales | AI Sales | sales_playbook | emerald |
| cskh | AI CSKH | cskh_plan | amber |
| hr | AI HR | hr_plan | blue |
| accountant | AI Kế Toán | accountant_plan | teal |
| legal | AI Pháp Lý | legal_plan | violet |

## Source of truth files
- **Prompts**: `artifacts/api-server/src/lib/agents.ts` — `AGENT_PROMPTS` + `ALL_AGENT_LABELS`
- **Frontend configs**: `artifacts/ai-company/src/lib/constants.ts` — `AGENT_CONFIG` + `AGENT_ORDER`
- **Memory types**: `lib/db/src/schema/project_memory.ts` — `MEMORY_TYPES` array
- **Memory saving**: `agents.ts` `memoryTypeMap` (lines ~329-337)

## CEO Orchestration flow
1. User clicks "Auto Orchestrate" → POST /api/projects/:id/run-all → creates CEO task
2. Worker picks up CEO task → streams to SSE → at end, calls `fetchCeoExecutionPlan()`
3. CEO selects which agents are needed from: `marketing, sales, cskh, hr, accountant, legal`
4. Creates sub-tasks in DB → enqueues each to BullMQ → Worker processes in parallel

## Why
The CEO decides dynamically which agents to run based on the business idea. Not all 6 sub-agents run every time — only the ones the CEO deems necessary. This is intentional smart orchestration.
