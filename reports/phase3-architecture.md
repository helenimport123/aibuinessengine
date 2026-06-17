# Phase 3 — Worker Separation Architecture
**Ngày hoàn thành:** 17/06/2026

---

## Tổng Quan

Phase 3 tách worker ra khỏi API server thành một process độc lập, sử dụng BullMQ + Redis làm message queue. API server chỉ nhận request và enqueue jobs; Worker process lấy job từ queue và thực thi.

---

## Kiến Trúc Tổng Thể

```
┌─────────────────────────────────────────────────────────────────────┐
│                        REPLIT ENVIRONMENT                            │
│                                                                       │
│  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────┐  │
│  │   Frontend       │      │   API Server     │      │   Worker    │  │
│  │  (port 5000)     │◄────►│   (port 8080)    │      │  (process)  │  │
│  │  React + Vite    │  SSE │  Express 5       │      │  BullMQ     │  │
│  └─────────────────┘      └────────┬────────┘      └──────┬──────┘  │
│                                     │                       │         │
│                                     │  ENQUEUE              │ CONSUME │
│                                     ▼                       ▼         │
│                            ┌─────────────────────────────────┐        │
│                            │         REDIS (Upstash)          │        │
│                            │   BullMQ Queue: "agent-jobs"     │        │
│                            │   - attempts: 3                  │        │
│                            │   - backoff: exponential 5s      │        │
│                            │   - jobId: task-{taskId}         │        │
│                            └─────────────────────────────────┘        │
│                                                                       │
│                            ┌─────────────────────────────────┐        │
│                            │     PostgreSQL (Replit DB)        │        │
│                            │  agent_tasks, agent_runs          │        │
│                            │  dead_letter_queue                │        │
│                            │  worker_heartbeat                 │        │
│                            └─────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Luồng Job Xử Lý

### Luồng CEO Agent (streaming realtime)
```
1. Frontend → POST /api/projects/:id/agents/ceo/run
2. API Server: SSE stream bắt đầu
3. API Server: runAgentForProject() chạy trực tiếp (stream về frontend)
4. CEO hoàn thành → createOrchestratedTasks()
5. onTasksCreated callback → enqueueAgentJob() × N sub-agents
6. N jobs được đẩy vào Redis Queue
7. Worker nhận job, chạy từng sub-agent
```

### Luồng Sub-Agent (background, không stream)
```
1. Worker dequeue job từ Redis
2. Worker: runAgentForProject() không có sendEvent
3. Kết quả ghi vào DB (agent_tasks.output)
4. Frontend polling `/api/tasks/:id` để lấy kết quả
```

---

## Components Chi Tiết

### API Server Changes

**`artifacts/api-server/src/lib/redis.ts`**
- IORedis client với URL parsing (handle format sai của REDIS_URL)
- `lazyConnect: true` — connect khi cần
- `maxRetriesPerRequest: null` — required by BullMQ

**`artifacts/api-server/src/lib/bullmq-queue.ts`**
- Queue producer: `agentQueue`
- Queue name: `"agent-jobs"`
- Default options: 3 attempts, exponential backoff 5s, deduplicate by `jobId: task-{taskId}`
- `enqueueAgentJob(data)` → trả về jobId

**`artifacts/api-server/src/lib/agents.ts`**
- Thêm `onTasksCreated?: OnTasksCreated` callback parameter
- CEO orchestration: gọi `onTasksCreated` thay vì `emitJobEvent` trực tiếp
- API server route inject callback để enqueue BullMQ jobs

**`artifacts/api-server/src/index.ts`**
- **REMOVED:** `worker.start()` — không còn in-process worker
- API server chỉ nhận request + enqueue

**`artifacts/api-server/src/routes/jobs.ts`**
- `GET /api/jobs` — recent tasks
- `GET /api/jobs/stats` — DB counts + BullMQ queue counts + worker heartbeats
- `GET /api/jobs/dlq` — dead letter queue entries
- `GET /api/jobs/stream` — SSE job events

---

### Worker Package (`artifacts/worker/`)

**Package structure:**
```
artifacts/worker/
├── package.json          @workspace/worker
├── tsconfig.json
├── build.mjs             esbuild bundler
└── src/
    ├── index.ts          Entry point, graceful shutdown
    ├── processor.ts      BullMQ Worker, job processing
    ├── bullmq-queue.ts   Queue producer (for CEO re-enqueue)
    ├── heartbeat.ts      HeartbeatReporter → worker_heartbeat table
    ├── dlq.ts            Dead Letter Queue writer
    ├── redis.ts          IORedis connection
    └── logger.ts         Pino logger
```

**`src/processor.ts` — Core Worker:**
```typescript
const worker = new Worker<AgentJobData>(
  "agent-jobs",
  async (job) => {
    // 1. Fetch project from DB
    // 2. Race: runAgentForProject() vs JOB_TIMEOUT_MS (5 min)
    // 3. CEO onTasksCreated: enqueue sub-agents back to BullMQ
    // 4. heartbeat.recordCompleted()
  },
  { connection: redisConnection, concurrency: WORKER_CONCURRENCY }
);

worker.on("failed", async (job, err) => {
  if (isExhausted) {
    // Mark task failed in DB
    // moveToDLQ()
  }
});
```

**`src/heartbeat.ts` — HeartbeatReporter:**
- Upsert vào `worker_heartbeat` table mỗi 10s
- Track: activeJobs, completedJobs, failedJobs, processedJobs
- `start(getActiveCount)` / `stop()`

**`src/dlq.ts` — Dead Letter Queue:**
- Sau 3 lần retry thất bại → insert vào `dead_letter_queue`
- Fields: taskId, agentType, projectId, failureReason, attemptCount, jobData, lastAttemptAt

---

### Database Schema Mới

**Bảng `dead_letter_queue`:**
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | |
| task_id | integer FK nullable | Ref đến agent_tasks |
| agent_type | text | ceo/marketing/sales/... |
| agent_name | text | Tên hiển thị |
| project_id | integer | ID dự án |
| failure_reason | text | Lý do thất bại |
| attempt_count | integer | Số lần đã thử |
| last_attempt_at | timestamp | Lần thử gần nhất |
| job_data | jsonb | Raw BullMQ job data |
| resolved_at | timestamp nullable | Đã xử lý? |
| resolved_by | text nullable | Ai xử lý? |
| created_at | timestamp | |

**Bảng `worker_heartbeat`:**
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | |
| worker_id | text UNIQUE | `worker-{PID}` |
| last_seen_at | timestamp | Lần heartbeat cuối |
| active_jobs | integer | Số jobs đang xử lý |
| completed_jobs | integer | Tổng đã hoàn thành |
| failed_jobs | integer | Tổng đã thất bại |
| processed_jobs | integer | Tổng đã xử lý |
| started_at | timestamp | Worker start time |
| metadata | jsonb | Extra info |

---

## Retry & DLQ Strategy

```
Job enqueued
     │
     ▼
Attempt 1 ──[fail]──► Wait 5s (backoff x1)
     │
     ▼
Attempt 2 ──[fail]──► Wait 10s (backoff x2)
     │
     ▼
Attempt 3 ──[fail]──► EXHAUSTED
     │
     ├──► agent_tasks.status = "failed"
     └──► INSERT INTO dead_letter_queue
```

**Job Timeout:** 5 phút per job (Promise.race vs setTimeout)

---

## Monitoring

### `GET /api/jobs/stats` Response:
```json
{
  "db": {
    "pending": 0, "running": 2, "completed": 45, "failed": 1
  },
  "queue": {
    "waiting": 0, "active": 2, "failed": 1, "completed": 45, "delayed": 0
  },
  "workers": [
    {
      "worker_id": "worker-12345",
      "last_seen_at": "2026-06-17T15:30:00.000Z",
      "active_jobs": 2,
      "completed_jobs": 45,
      "failed_jobs": 1,
      "processed_jobs": 46
    }
  ]
}
```

---

## Graceful Shutdown

```typescript
process.on("SIGTERM", async () => {
  heartbeat.stop();
  await worker.close(); // BullMQ drains active jobs
  process.exit(0);
});
```

---

## Cấu Hình

| Biến môi trường | Mặc định | Mô tả |
|-----------------|---------|-------|
| `REDIS_URL` | required | URL kết nối Redis/Upstash |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `WORKER_CONCURRENCY` | `3` | Số jobs xử lý song song |
| `LOG_LEVEL` | `info` | Pino log level |

---

## Files Changed / Created

| File | Thay đổi |
|------|---------|
| `lib/db/src/schema/dlq.ts` | Tạo mới: dead_letter_queue + worker_heartbeat |
| `lib/db/src/schema/index.ts` | Export dlq schema |
| `artifacts/api-server/src/lib/redis.ts` | Tạo mới: IORedis client |
| `artifacts/api-server/src/lib/bullmq-queue.ts` | Tạo mới: BullMQ producer |
| `artifacts/api-server/src/lib/agents.ts` | Thêm onTasksCreated callback |
| `artifacts/api-server/src/lib/worker.ts` | Legacy in-process worker (kept, not started) |
| `artifacts/api-server/src/index.ts` | Remove worker.start() |
| `artifacts/api-server/src/routes/jobs.ts` | Update: BullMQ stats + DLQ endpoint |
| `artifacts/api-server/src/routes/agent-tasks.ts` | Inject onTasksCreated for BullMQ |
| `artifacts/worker/package.json` | Tạo mới: worker package |
| `artifacts/worker/src/index.ts` | Entry point + graceful shutdown |
| `artifacts/worker/src/processor.ts` | BullMQ Worker processor |
| `artifacts/worker/src/bullmq-queue.ts` | Queue producer for CEO re-enqueue |
| `artifacts/worker/src/heartbeat.ts` | Heartbeat reporter |
| `artifacts/worker/src/dlq.ts` | DLQ writer |
| `artifacts/worker/src/redis.ts` | Worker Redis client |
| `artifacts/worker/src/logger.ts` | Pino logger |
| `.replit` | Thêm Worker workflow |
