---
name: Vite Proxy + No-Auth ownerFilter
description: Vite dev server needs explicit proxy for /api → port 8080; null userId must use isNull() not eq(col, null) in ownerFilter.
---

## Rule
The Vite frontend (port 5000) must proxy `/api/*` to the API server (port 8080) via `server.proxy` in `vite.config.ts`. Without this, all `/api/*` requests return the SPA HTML (404 effectively).

For SSE streaming endpoints (agents/run, jobs/stream), configure the proxy's `proxyReq` handler to strip `accept-encoding` on `text/event-stream` requests to prevent gzip buffering.

## Why
- `baseUrl: "/api"` is set in `lib/api-spec/orval.config.ts` — all generated API calls are relative paths prefixed with `/api`.
- Vite SPA mode returns `index.html` for unknown routes, silently making API calls appear to succeed with 200 but returning HTML.
- Debugging symptom: dashboard shows 0 projects despite API returning data from direct curl.

## No-Auth ownerFilter
When auth is removed, `getAuthUser()` returns `null`. All `ownerFilter` functions across routes must accept `string | null`:

```typescript
function ownerFilter(userId: string | null) {
  if (!userId) return isNull(table.userId);
  return or(eq(table.userId, userId), isNull(table.userId));
}
```

Do NOT rely on `eq(column, null)` — Drizzle ORM behavior with null in eq() is undefined and may vary across versions. Always use explicit `isNull()`.

## How to apply
- Any new route file that queries by userId must use the `string | null` ownerFilter pattern.
- Any new Vite app that calls a separate API server port must add `server.proxy` to its vite.config.ts.
