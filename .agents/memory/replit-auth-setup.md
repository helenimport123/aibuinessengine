---
name: Replit Auth Setup
description: How Replit OIDC auth is wired into this pnpm monorepo's api-server
---

## Auth implementation location
- `artifacts/api-server/src/lib/auth.ts` — setupAuth() sets up passport + express-session + OIDC strategy + /api/login, /api/callback, /api/logout routes
- `artifacts/api-server/src/middlewares/auth.ts` — requireAuth middleware + getAuthUser(req) helper
- `artifacts/api-server/src/routes/auth.ts` — GET /api/auth/me endpoint
- `artifacts/ai-company/src/hooks/use-auth.ts` — React hook fetching /api/auth/me
- `artifacts/ai-company/src/pages/login.tsx` — Login page shown when unauthenticated

## DB tables
- `lib/db/src/schema/users.ts` — users table (id=Replit sub claim, text PK) + sessions table (for connect-pg-simple)
- `userId text` added to projects and conversations (nullable for backward compat with legacy data)

## Key decisions
- `app.ts` became async `createApp()` — index.ts awaits it before listen()
- Auth routes (/api/login, /api/callback, /api/logout) registered directly on app, NOT under /api router
- Session store uses connect-pg-simple pointing to sessions table (must exist before server starts → db push first)
- Ownership filter: `or(eq(table.userId, userId), isNull(table.userId))` — legacy null-userId rows accessible to any authenticated user
- REPLIT_DOMAINS env var used to determine callback URL domain (robust vs req.hostname which may be localhost through Vite proxy)
- SESSION_SECRET already set as a Replit secret

**Why:**
- Monorepo has api-server (port 8080) behind Vite proxy (port 5000) — req.hostname at API level may be localhost, so REPLIT_DOMAINS is more reliable for OIDC callback URL
- Nullable userId preserves existing data (không phá dữ liệu cũ) while new records get proper ownership
