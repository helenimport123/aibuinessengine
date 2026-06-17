# Tiến Trình Hệ Thống — AI Company-in-a-Box

---

## Lịch Sử Build

| Thời gian | Tính năng | Trạng thái |
|-----------|-----------|-----------|
| 22:45 — 17/06/2026 | **Phase 3 Worker Separation:** Tách Worker khỏi API server thành process độc lập. BullMQ Queue (Redis/Upstash), Retry 3 lần + exponential backoff 5s, Dead Letter Queue (bảng `dead_letter_queue`), Job Timeout 5 phút, Heartbeat 10s (bảng `worker_heartbeat`), Monitoring endpoints (`/api/jobs/stats`, `/api/jobs/dlq`). Worker workflow riêng trong .replit. Report tại `reports/phase3-architecture.md`. | ✅ Hoàn thành |
| 22:40 — 17/06/2026 | **Phase 2 Cost Protection:** Rate limiting (express-rate-limit), budget guard per-user ($10/tháng mặc định), daily token quota (100K/ngày), cost dashboard (`/api/cost/summary`), usage tracking (`usage_daily` + `budget_config` tables), admin override, CSV export. Report tại `reports/phase2-cost-protection.md`. | ✅ Hoàn thành |
| 22:31 — 17/06/2026 | Migration sang Replit: cài packages, push DB schema, cấu hình workflows (API Server port 8080, Frontend port 5000), tích hợp Replit Auth OIDC, request OPENAI_API_KEY | ✅ Hoàn thành |

---

> File này mô tả toàn bộ kiến trúc và tiến trình xây dựng hệ thống. Được thiết kế để **auto-build** — đọc file này là đủ để tái tạo toàn bộ dự án mà không cần hỏi thêm người dùng.

---

## Mục Tiêu

Xây dựng một hệ thống AI có thể tự vận hành gần như toàn bộ doanh nghiệp. Người dùng chỉ cần nhập ý tưởng kinh doanh, hệ thống AI sẽ tự động xử lý toàn bộ các phòng ban.

**Ví dụ đầu vào:**
> "Tôi muốn mở công ty bán mỹ phẩm tại Việt Nam"

**Hệ thống tự động:**
- Nghiên cứu thị trường (AI CEO)
- Lên chiến lược marketing & chạy quảng cáo (AI Marketing)
- Tìm khách hàng tiềm năng & viết kịch bản bán hàng (AI Sales)
- Soạn FAQ & quy trình chăm sóc khách hàng (AI CSKH)
- Lên kế hoạch tuyển dụng & mô tả công việc (AI HR)
- Dự toán tài chính & ngân sách (AI Accountant)
- Soạn hợp đồng & checklist pháp lý (AI Legal)

---

## Stack Công Nghệ

| Lớp | Công nghệ |
|-----|-----------|
| Frontend | React 19 + Vite + TailwindCSS + shadcn/ui |
| Backend | Node.js 24 + Express 5 + TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| AI Engine | OpenAI GPT-4.1 (qua OPENAI_API_KEY) |
| Job Queue | BullMQ + Redis (Upstash) |
| Monorepo | pnpm workspaces |
| API Contract | OpenAPI 3.1 + Orval codegen |
| Validation | Zod v4 + drizzle-zod |

---

## Kiến Trúc Hệ Thống (Phase 3)

```
workspace/
├── artifacts/
│   ├── ai-company/          # React frontend (port 5000)
│   ├── api-server/          # Express backend (port 8080)
│   └── worker/              # BullMQ Worker process (background)
├── lib/
│   ├── api-spec/            # OpenAPI contract
│   ├── api-client-react/    # Generated React Query hooks
│   ├── api-zod/             # Generated Zod schemas
│   ├── agents/              # Shared agent runner lib (api-server + worker)
│   └── db/                  # PostgreSQL schema + Drizzle
├── reports/
│   ├── phase2-cost-protection.md
│   └── phase3-architecture.md
└── tientrinhhethong.md      # File này
```

### Luồng Job Processing

```
Frontend → POST /api/projects/:id/agents/ceo/run
         → API Server: CEO runs in-process with SSE streaming
         → CEO hoàn thành → createOrchestratedTasks()
         → enqueueAgentJob() × N sub-agents → Redis Queue
         → Worker process dequeues → runAgentForProject()
         → Retry 3 lần nếu thất bại → DLQ sau khi exhausted
```

---

## Workflows (Replit)

| Workflow | Command | Port | Mô tả |
|----------|---------|------|-------|
| API Server | `PORT=8080 pnpm --filter @workspace/api-server run dev` | 8080 | Express API + BullMQ producer |
| Frontend | `PORT=5000 pnpm --filter @workspace/ai-company run dev` | 5000 | React app |
| Worker | `pnpm --filter @workspace/worker run dev` | — | BullMQ consumer |

---

## Các AI Agents

### 1. AI CEO — Phân tích thị trường
- **Role:** `ceo`
- **Nhiệm vụ:** Phân tích SWOT, xu hướng thị trường, cơ hội kinh doanh, đề xuất chiến lược tổng thể
- **Output:** Báo cáo phân tích thị trường chi tiết (Markdown)
- **Đặc biệt:** CEO tạo execution plan → orchestrate sub-agents vào BullMQ queue

### 2. AI Marketing — Chiến lược & quảng cáo
- **Role:** `marketing`
- **Nhiệm vụ:** Xây dựng brand identity, chiến lược content, kế hoạch chạy quảng cáo
- **Output:** Marketing plan + Ad copy mẫu

### 3. AI Sales — Tìm khách & bán hàng
- **Role:** `sales`
- **Nhiệm vụ:** Xác định khách hàng mục tiêu, funnel bán hàng, kịch bản call/email
- **Output:** Sales playbook

### 4. AI CSKH — Chăm sóc khách hàng
- **Role:** `cskh`
- **Nhiệm vụ:** Soạn FAQ, quy trình xử lý khiếu nại, loyalty program
- **Output:** Customer service handbook

### 5. AI HR — Nhân sự & tuyển dụng
- **Role:** `hr`
- **Nhiệm vụ:** Sơ đồ tổ chức, mô tả công việc, quy trình tuyển dụng
- **Output:** HR package

### 6. AI Accountant — Kế toán & tài chính
- **Role:** `accountant`
- **Nhiệm vụ:** Dự toán vốn ban đầu, chi phí vận hành, dự báo doanh thu 12 tháng
- **Output:** Financial model + budget plan

### 7. AI Legal — Pháp lý & hợp đồng
- **Role:** `legal`
- **Nhiệm vụ:** Checklist đăng ký doanh nghiệp, mẫu hợp đồng, điều khoản & điều kiện
- **Output:** Legal package

---

## Database Schema

### Core Tables
| Bảng | Mô tả |
|------|-------|
| `projects` | Dự án kinh doanh |
| `agent_tasks` | Tasks của từng agent (pending/running/completed/failed) |
| `agent_runs` | Lịch sử chạy + tokens + cost |
| `conversations` | AI chat conversations |
| `messages` | Chat messages |
| `knowledge_base` | KB per project |
| `project_memory` | Structured memory (CEO report, marketing plan, ...) |
| `users` | User profiles (Replit Auth) |

### Phase 2 Tables (Cost Protection)
| Bảng | Mô tả |
|------|-------|
| `usage_daily` | Token/cost usage per user per day |
| `budget_config` | Monthly budget + daily token quota per user |

### Phase 3 Tables (Worker)
| Bảng | Mô tả |
|------|-------|
| `dead_letter_queue` | Failed jobs sau 3 lần retry |
| `worker_heartbeat` | Worker health + stats mỗi 10s |

---

## API Endpoints

### Core
| Method | Path | Mô tả |
|--------|------|-------|
| GET | /api/healthz | Health check |
| GET | /api/projects | Danh sách dự án |
| POST | /api/projects | Tạo dự án mới |
| GET | /api/projects/:id | Chi tiết dự án + tasks |
| DELETE | /api/projects/:id | Xóa dự án |
| POST | /api/projects/:id/agents/:type/run | Chạy agent (SSE) |
| GET | /api/tasks | Danh sách tasks |

### Phase 2 — Cost
| Method | Path | Mô tả |
|--------|------|-------|
| GET | /api/cost/summary | Usage dashboard |
| PUT | /api/cost/config | Update budget/quota |
| GET | /api/cost/export | CSV export |

### Phase 3 — Jobs & Monitoring
| Method | Path | Mô tả |
|--------|------|-------|
| GET | /api/jobs | Recent 60 tasks |
| GET | /api/jobs/stats | DB + BullMQ + worker heartbeats |
| GET | /api/jobs/dlq | Dead letter queue entries |
| GET | /api/jobs/stream | SSE realtime job events |

---

## Quy Trình Auto-Build

### Bước 1: Secrets cần thiết
```
OPENAI_API_KEY  — OpenAI API key
REDIS_URL       — Redis/Upstash URL (format: rediss://default:PASSWORD@host:PORT)
DATABASE_URL    — PostgreSQL connection string (tự động tạo bởi Replit)
```

### Bước 2: Install + Setup
```bash
pnpm install
pnpm --filter @workspace/db run push
```

### Bước 3: Build
```bash
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/worker run build
```

### Bước 4: Chạy (3 workflows song song)
```bash
PORT=8080 BASE_PATH=/api pnpm --filter @workspace/api-server run dev  # API Server
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ai-company run dev      # Frontend
pnpm --filter @workspace/worker run dev                                  # Worker
```

---

## Lưu Ý Quan Trọng

- **REDIS_URL format:** Phải là `rediss://default:PASSWORD@host:PORT` (không phải `redis-cli --tls -u ...`)
- **SSE Streaming:** CEO agent stream trực tiếp về frontend; sub-agents xử lý qua BullMQ background
- **In-process fallback:** `artifacts/api-server/src/lib/worker.ts` vẫn tồn tại nhưng không được start
- **Ngôn ngữ:** Toàn bộ AI output bằng tiếng Việt
- **Model:** Sử dụng `gpt-4.1`
- **Cost defaults:** $10/tháng, 100K tokens/ngày per user
