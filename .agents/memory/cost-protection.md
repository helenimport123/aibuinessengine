---
name: Phase 2 Cost Protection
description: Rate limiting, budget guards, token tracking, and cost dashboard implementation
---

## DB Tables (lib/db/src/schema/usage.ts)
- `usage_daily` — (userId, date YYYY-MM-DD, totalTokens, totalCost, requestCount, agentRunCount, chatMessageCount) with uniqueIndex on (userId, date) for upsert via onConflictDoUpdate
- `budget_config` — (userId nullable = global default, dailyTokenLimit, monthlyTokenLimit, monthlyBudgetUsd, rateLimitRpm, isAdminOverride)
- NOTE: budget_config has NO unique index on userId because PostgreSQL NULL != NULL. Upsert is handled with manual check-then-insert-or-update in routes/cost.ts.

## Core lib: artifacts/api-server/src/lib/cost.ts
- `trackUsage(userId, tokens, cost, type)` — upserts usage_daily via onConflictDoUpdate with excluded.* SQL
- `getBudgetConfig(userId)` — user-specific config OR global (null userId) OR env var defaults
- `checkBudget(userId)` — monthly spend check; isAdminOverride bypasses
- `checkDailyQuota(userId)` — daily token check; isAdminOverride bypasses
- `getUsageSummary(userId)` — full stats for dashboard (today, thisMonth, history 30 days, budget %, dailyQuota %)
- `isAdmin(userId)` — checks ADMIN_USER_IDS env var (comma-separated)

## Rate Limiting (app.ts)
- `express-rate-limit` v7.x (bundled types, no @types needed)
- 120 RPM default, configurable via RATE_LIMIT_RPM env var
- Key: userId from req.user?.claims?.sub, fallback to IP
- Applied AFTER setupAuth so req.user is available
- Login/callback/logout routes are NOT rate-limited (registered before the limiter)

## Budget Guards in AI routes
Pattern for all 4 routes (agents.ts, chat.ts, advisor.ts, openai-conversations.ts):
1. Check budget BEFORE SSE headers are set (returns proper JSON error, not SSE error)
2. Use Promise.all([checkBudget, checkDailyQuota]) in parallel
3. Budget exceeded → 402 Payment Required
4. Daily quota exceeded → 429 Too Many Requests
5. agents.ts: check inside try block (so error flows through existing error handling → task marked failed)
6. After completion: trackUsage(userId, tokens, cost, type) with .catch(() => {}) so tracking failures never break the AI response

## Frontend (/cost page)
- Route added to App.tsx as /cost
- 4 stat cards, 2 progress bars (budget % + daily quota %), today breakdown, 30-day history table
- "Xuất CSV" button links to GET /api/cost/export (CSV with BOM for Excel Vietnamese support)
- Admin config section (shown only when config.isAdmin = true): edit daily/monthly limits, budget USD, RPM, admin override toggle

## Admin Override
- Set ADMIN_USER_IDS env var with comma-separated Replit sub claims
- OR set isAdminOverride=true in budget_config table via PUT /api/cost/config (requires existing admin)
- Admin override skips ALL budget and quota checks

## Pre-existing typecheck errors (not Phase 2)
- integrations-openai-ai-server dist not built (TS6305) — affects agents.ts, chat.ts, advisor.ts, openai-conversations.ts import lines
- auth.ts IDToken possibly undefined (TS2345) — pre-existing
- These do NOT affect runtime (esbuild builds successfully)

**Why:**
- Budget check BEFORE SSE headers because once SSE headers are sent (Content-Type: text/event-stream), the client expects SSE chunks, not JSON errors
- budget_config NULL userId = global default avoids needing a separate migration or a special row ID; queried separately
- trackUsage with .catch() to ensure tracking failure never silently breaks AI responses
