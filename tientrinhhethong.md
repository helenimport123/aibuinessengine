# Tiến Trình Hệ Thống — AI Company-in-a-Box

---

## Lịch Sử Build

| Thời gian | Tính năng | Trạng thái |
|-----------|-----------|-----------|
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
| AI Engine | OpenAI GPT-4 (qua OPENAI_API_KEY) |
| Monorepo | pnpm workspaces |
| API Contract | OpenAPI 3.1 + Orval codegen |
| Validation | Zod v4 + drizzle-zod |

---

## Kiến Trúc Hệ Thống

```
workspace/
├── artifacts/
│   ├── ai-company/          # React frontend (preview path: /)
│   └── api-server/          # Express backend (preview path: /api)
├── lib/
│   ├── api-spec/            # OpenAPI contract (nguồn sự thật)
│   ├── api-client-react/    # Generated React Query hooks
│   ├── api-zod/             # Generated Zod schemas
│   └── db/                  # PostgreSQL schema + Drizzle
└── tientrinhhethong.md      # File này
```

---

## Các AI Agents

### 1. AI CEO — Phân tích thị trường
- **Role:** `ceo`
- **Nhiệm vụ:** Phân tích SWOT, xu hướng thị trường, cơ hội kinh doanh, đề xuất chiến lược tổng thể
- **Output:** Báo cáo phân tích thị trường chi tiết (Markdown)

### 2. AI Marketing — Chiến lược & quảng cáo
- **Role:** `marketing`
- **Nhiệm vụ:** Xây dựng brand identity, chiến lược content, kế hoạch chạy quảng cáo Facebook/Google, KPI
- **Output:** Marketing plan + Ad copy mẫu

### 3. AI Sales — Tìm khách & bán hàng
- **Role:** `sales`
- **Nhiệm vụ:** Xác định khách hàng mục tiêu, funnel bán hàng, kịch bản call/email, closing techniques
- **Output:** Sales playbook + danh sách leads tiềm năng

### 4. AI CSKH — Chăm sóc khách hàng
- **Role:** `cskh`
- **Nhiệm vụ:** Soạn FAQ, quy trình xử lý khiếu nại, templates phản hồi, loyalty program
- **Output:** Customer service handbook

### 5. AI HR — Nhân sự & tuyển dụng
- **Role:** `hr`
- **Nhiệm vụ:** Sơ đồ tổ chức, mô tả công việc, quy trình tuyển dụng, chính sách lương thưởng
- **Output:** HR package (JD + org chart + hiring plan)

### 6. AI Accountant — Kế toán & tài chính
- **Role:** `accountant`
- **Nhiệm vụ:** Dự toán vốn ban đầu, chi phí vận hành, dự báo doanh thu 12 tháng, điểm hòa vốn
- **Output:** Financial model + budget plan

### 7. AI Legal — Pháp lý & hợp đồng
- **Role:** `legal`
- **Nhiệm vụ:** Checklist đăng ký doanh nghiệp, mẫu hợp đồng, điều khoản & điều kiện, lưu ý pháp lý
- **Output:** Legal package (contracts + compliance checklist)

---

## Database Schema

### Bảng `projects`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | ID dự án |
| name | text | Tên dự án |
| business_idea | text | Ý tưởng kinh doanh |
| industry | text nullable | Ngành nghề |
| target_market | text nullable | Thị trường mục tiêu |
| status | text | draft / running / completed |
| completion_percent | integer | % hoàn thành (0-100) |
| created_at | timestamp | Thời gian tạo |

### Bảng `agent_tasks`
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | ID task |
| project_id | integer FK | ID dự án |
| agent_type | text | ceo/marketing/sales/cskh/hr/accountant/legal |
| agent_name | text | Tên hiển thị của agent |
| status | text | pending/running/completed/failed |
| output | text nullable | Kết quả từ AI |
| error_message | text nullable | Lỗi nếu có |
| created_at | timestamp | Thời gian tạo |
| completed_at | timestamp nullable | Thời gian hoàn thành |

### Bảng `conversations` (cho AI chat)
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | ID conversation |
| title | text | Tiêu đề |
| created_at | timestamp | Thời gian tạo |

### Bảng `messages` (cho AI chat)
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | ID message |
| conversation_id | integer FK | ID conversation |
| role | text | user/assistant |
| content | text | Nội dung |
| created_at | timestamp | Thời gian tạo |

---

## API Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | /api/healthz | Health check |
| GET | /api/projects | Danh sách dự án |
| POST | /api/projects | Tạo dự án mới |
| GET | /api/projects/:id | Chi tiết dự án + tasks |
| DELETE | /api/projects/:id | Xóa dự án |
| GET | /api/projects/:id/summary | Dashboard summary |
| POST | /api/projects/:id/run-all | Chạy tất cả agents (SSE) |
| POST | /api/projects/:id/agents/:agentType/run | Chạy 1 agent cụ thể (SSE) |
| GET | /api/tasks | Danh sách tasks |
| GET | /api/tasks/:id | Chi tiết task |
| GET | /api/openai/conversations | Danh sách chat |
| POST | /api/openai/conversations | Tạo conversation mới |
| GET | /api/openai/conversations/:id | Chi tiết conversation |
| DELETE | /api/openai/conversations/:id | Xóa conversation |
| GET | /api/openai/conversations/:id/messages | Danh sách messages |
| POST | /api/openai/conversations/:id/messages | Gửi tin nhắn (SSE) |

---

## Các Trang Frontend

| Route | Tên | Mô tả |
|-------|-----|-------|
| `/` | Dashboard | Tổng quan + danh sách dự án |
| `/new` | Tạo dự án | Form nhập ý tưởng kinh doanh |
| `/projects/:id` | Chi tiết dự án | Dashboard 7 agents + tiến độ |
| `/projects/:id/agents/:type` | Chi tiết Agent | Output của 1 agent cụ thể |
| `/chat` | AI Chat | Chat tự do với AI advisor |

---

## Quy Trình Auto-Build (Không cần hỏi người dùng)

### Bước 1: Setup môi trường
```bash
# Đảm bảo có OPENAI_API_KEY trong secrets
# Đảm bảo có DATABASE_URL (tạo database PostgreSQL)
```

### Bước 2: Cài dependencies
```bash
pnpm install --no-frozen-lockfile
```

### Bước 3: Codegen từ OpenAPI spec
```bash
pnpm --filter @workspace/api-spec run codegen
```

### Bước 4: Push database schema
```bash
pnpm --filter @workspace/db run push
```

### Bước 5: Build và chạy
```bash
# API server (port từ env PORT)
pnpm --filter @workspace/api-server run dev

# Frontend (port từ env PORT)  
pnpm --filter @workspace/ai-company run dev
```

---

## Prompt Templates cho từng AI Agent

### CEO Agent Prompt
```
Bạn là AI CEO chuyên phân tích thị trường cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: {businessIdea}
Ngành: {industry}
Thị trường mục tiêu: {targetMarket}

Hãy tạo báo cáo phân tích thị trường đầy đủ bao gồm:
1. Tổng quan thị trường và quy mô
2. Phân tích SWOT chi tiết
3. Đối thủ cạnh tranh chính
4. Cơ hội và thách thức
5. Chiến lược tổng thể đề xuất
6. KPI và mục tiêu 12 tháng

Viết bằng tiếng Việt, chuyên nghiệp và chi tiết.
```

### Marketing Agent Prompt
```
Bạn là AI Marketing Director cho doanh nghiệp Việt Nam.
Ý tưởng kinh doanh: {businessIdea}

Hãy xây dựng kế hoạch marketing đầy đủ:
1. Brand identity (tên, logo concept, tagline)
2. Target audience chi tiết (demographics, psychographics)
3. Chiến lược content marketing
4. Kế hoạch quảng cáo Facebook Ads + Google Ads
5. Budget marketing đề xuất
6. KPI và metrics theo dõi
7. Content calendar 1 tháng mẫu

Viết bằng tiếng Việt, thực tế và có thể triển khai ngay.
```

*(Xem source code cho các prompt chi tiết của Sales, CSKH, HR, Accountant, Legal)*

---

## Lưu Ý Quan Trọng

- **OpenAI API Key:** Bắt buộc, lưu trong Replit Secrets với key `OPENAI_API_KEY`
- **Database:** PostgreSQL được provision tự động bởi Replit
- **SSE Streaming:** Các agent chạy qua Server-Sent Events để hiển thị output real-time
- **Ngôn ngữ:** Toàn bộ AI output bằng tiếng Việt
- **Model:** Sử dụng `gpt-4.1` cho chất lượng tốt nhất
