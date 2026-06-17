---
name: Job Queue Architecture
description: How the background job worker and queue system works in this app.
---

## Design

- `agent_tasks` IS the job queue. Status values: `pending` | `running` | `completed` | `failed`.
- `queuedAt` timestamp on `agent_tasks` is the key discriminator: worker only picks up tasks where `queued_at IS NOT NULL`. Tasks created on project creation get `queuedAt = null` (user must trigger manually). Tasks queued via run-all or CEO orchestration get `queuedAt = new Date()`.
- Worker (`lib/worker.ts`) uses raw SQL `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction to atomically claim jobs — scale-safe for multiple workers.
- `lib/queue.ts` exports `emitJobEvent()` and `jobBus` (Node EventEmitter, maxListeners 200).
- Worker starts in `index.ts` after `app.listen()`.
- `WORKER_CONCURRENCY` env var controls concurrency (default 3).

## Two execution modes

1. **Interactive SSE**: User clicks agent run button on detail page → `POST /api/projects/:id/agents/:type/run` → SSE stream direct (bypasses queue). 409 guard blocks if task is already `running`.
2. **Queue/Background**: User clicks "AUTO ORCHESTRATE" → `POST /api/projects/:id/run-all` → returns 202 immediately → worker picks up CEO → CEO creates orchestrated tasks with `queuedAt` → worker picks them up too.

## Key endpoints

- `GET /api/jobs` — recent 60 tasks with project names (JOIN)
- `GET /api/jobs/stats` — pending/running/completed/failed counts + worker info
- `GET /api/jobs/stream` — SSE real-time job events (heartbeat every 25s)

## Dashboard

`dashboard.tsx` uses `EventSource` to subscribe to `/api/jobs/stream` and displays running/queued/recent jobs in a right-side panel with color-coded agent badges.

**Why:**
Separating `queuedAt` from status avoids a new status enum value while cleanly distinguishing "user hasn't run this yet" from "actively queued for background processing".
