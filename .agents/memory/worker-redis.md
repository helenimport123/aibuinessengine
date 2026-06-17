---
name: Phase 3 Worker + Redis
description: BullMQ Worker separation, Upstash Redis quirks, REDIS_URL format handling
---

## Rule
Worker (`artifacts/worker/`) runs as a separate process from API server. API server only enqueues; Worker dequeues and executes.

## Upstash Redis ECONNRESET
Upstash resets idle TCP connections after ~5-10 seconds. IORedis logs `ECONNRESET` + reconnects automatically. This is **normal behavior** — not a bug. The server and worker stay RUNNING and process jobs correctly.

**Why:** Upstash enforces idle connection limits. IORedis `enableReadyCheck: false` + auto-reconnect handles this transparently.

**How to apply:** Do not try to "fix" ECONNRESET logs from Upstash. They are expected noise.

## REDIS_URL Format Issue
User may set REDIS_URL as `redis://redis-cli --tls -u rediss://...` instead of bare URL.
Fix: extract actual URL with regex `/(rediss?:\/\/[^\s]+)/`.

## TLS for Upstash
Upstash requires TLS. URL starts with `rediss://` (double-s).
IORedis option: `tls: { rejectUnauthorized: false }` when URL starts with `rediss://`.

## CEO Orchestration Callback
`runAgentForProject()` accepts optional `onTasksCreated` callback. API server route injects `enqueueAgentJob()` call. Worker processor also injects `enqueueAgentJob()` for re-queuing CEO-orchestrated sub-tasks.
