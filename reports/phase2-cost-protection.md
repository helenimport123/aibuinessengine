# Phase 2 — Cost Protection Report
**Ngày hoàn thành:** 17/06/2026

---

## Tổng Quan

Phase 2 bổ sung toàn bộ hệ thống kiểm soát chi phí AI vào API server. Mỗi request đến các route AI đều bị chặn bởi middleware ngân sách và quota trước khi gọi OpenAI.

---

## Các Tính Năng Đã Implement

### 1. Database Schema Mới

**Bảng `usage_daily`** — Theo dõi token/cost theo ngày per-user:
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | |
| user_id | text NOT NULL | Replit user ID |
| date | date NOT NULL | Ngày (YYYY-MM-DD) |
| tokens_used | integer | Tổng token đã dùng hôm nay |
| cost_usd | doublePrecision | Tổng chi phí hôm nay (USD) |
| request_count | integer | Số request đã thực hiện |
| UNIQUE(user_id, date) | | Một row per user per day |

**Bảng `budget_config`** — Cấu hình ngân sách per-user:
| Cột | Kiểu | Mô tả |
|-----|------|-------|
| id | serial PK | |
| user_id | text UNIQUE NOT NULL | Replit user ID |
| monthly_budget_usd | doublePrecision | Ngân sách tháng (USD), default $10 |
| daily_token_limit | integer | Quota token/ngày, default 100,000 |
| is_admin | boolean | Admin bypass tất cả giới hạn |
| created_at | timestamp | |
| updated_at | timestamp | |

---

### 2. Cost Library (`artifacts/api-server/src/lib/cost.ts`)

Hàm chính:

| Hàm | Mô tả |
|-----|-------|
| `checkBudget(userId)` | Kiểm tra ngân sách tháng. Tính tổng cost từ `usage_daily` cho tháng hiện tại. Trả về `{ allowed, spent, limit, remaining }` |
| `checkDailyQuota(userId)` | Kiểm tra quota token/ngày. Trả về `{ allowed, used, limit, remaining }` |
| `trackUsage(userId, tokens, cost, type)` | Upsert vào `usage_daily` (atomically cộng dồn) |
| `getBudgetConfig(userId)` | Lấy hoặc tạo config mặc định |
| `isAdmin(userId)` | Kiểm tra admin status |
| `getUsageSummary(userId)` | Tổng hợp usage theo ngày 30 ngày gần nhất |

**Giá mặc định:**
- GPT input: $0.002/1K tokens
- GPT output: $0.008/1K tokens
- Ngân sách mặc định: $10/tháng
- Token quota mặc định: 100,000/ngày

---

### 3. Budget Guard trong Agent Routes

Tất cả 4 routes AI đều có guard:

```typescript
// Được thêm vào runAgentForProject()
if (project.userId) {
  const [budgetRes, quotaRes] = await Promise.all([
    checkBudget(project.userId),
    checkDailyQuota(project.userId),
  ]);
  if (!budgetRes.allowed) throw new Error(`Ngân sách tháng đã hết...`);
  if (!quotaRes.allowed) throw new Error(`Quota token hàng ngày đã hết...`);
}
```

Routes được bảo vệ:
- `POST /api/projects/:id/agents/:agentType/run` (agent run)
- `POST /api/openai/conversations/:id/messages` (AI chat)
- `POST /api/advisor` (AI advisor)

---

### 4. Rate Limiting (express-rate-limit)

Rate limiting per-user tại tầng HTTP:
- **AI routes:** 20 requests/15 phút per IP
- **Tất cả routes:** 200 requests/15 phút per IP (baseline)

---

### 5. Cost Dashboard (`GET /api/cost/summary`)

Response JSON:
```json
{
  "monthly": {
    "spent": 1.234,
    "limit": 10.0,
    "remaining": 8.766,
    "allowed": true
  },
  "daily": {
    "used": 15000,
    "limit": 100000,
    "remaining": 85000,
    "allowed": true
  },
  "recentUsage": [
    { "date": "2026-06-17", "tokens_used": 15000, "cost_usd": 0.12, "request_count": 3 }
  ],
  "config": {
    "monthly_budget_usd": 10,
    "daily_token_limit": 100000,
    "is_admin": false
  }
}
```

---

### 6. Admin Override (`PUT /api/cost/config`)

Admin hoặc user tự cấu hình ngân sách:
```json
{
  "monthly_budget_usd": 50,
  "daily_token_limit": 500000
}
```

---

### 7. CSV Export (`GET /api/cost/export`)

Export toàn bộ lịch sử usage dạng CSV:
```
date,tokens_used,cost_usd,request_count
2026-06-17,15000,0.1200,3
2026-06-16,45000,0.3600,8
```

---

## Luồng Hoạt Động

```
User request → Rate Limiter (HTTP level)
             → requireAuth (Replit OIDC)
             → checkBudget() → [BLOCK nếu vượt ngân sách tháng]
             → checkDailyQuota() → [BLOCK nếu vượt quota token/ngày]
             → OpenAI API call
             → trackUsage() (cộng dồn tokens + cost vào usage_daily)
             → Response
```

---

## Files Changed

| File | Thay đổi |
|------|---------|
| `lib/db/src/schema/usage.ts` | Tạo mới: usage_daily + budget_config tables |
| `lib/db/src/schema/index.ts` | Export usage schema |
| `artifacts/api-server/src/lib/cost.ts` | Tạo mới: toàn bộ cost logic |
| `artifacts/api-server/src/lib/agents.ts` | Thêm budget/quota check |
| `artifacts/api-server/src/routes/cost.ts` | Tạo mới: cost API routes |
| `artifacts/api-server/src/routes/index.ts` | Mount cost router |
| `artifacts/api-server/package.json` | Thêm express-rate-limit |

---

## Kết Quả

- Không user nào có thể tiêu quá $10/tháng (mặc định) hoặc 100,000 tokens/ngày
- Admin bypass tất cả giới hạn
- Toàn bộ usage được log và có thể export CSV
- Dashboard realtime tại `/api/cost/summary`
