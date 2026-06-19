---
name: Executive Dashboard
description: Architecture and lessons for the /projects/:id/executive feature.
---

## Route
- Frontend: `/projects/:id/executive` → `executive-dashboard.tsx`
- Backend GET: `/api/projects/:id/executive` → returns `{project, tasks, executive: ExecutiveData | null}`
- Backend POST: `/api/projects/:id/executive/generate` → runs Groq AI, caches, returns `ExecutiveData`

## Data caching
- Cached in `project_memory` table under type `executive_data` (added to MEMORY_TYPES)
- Single JSON blob (not split into separate entries)
- Upsert logic: replaces existing `executive_data` entry on regenerate

## AI extraction approach
- Single AI call using `response_format: { type: "json_object" }` with llama-3.3-70b-versatile
- All completed agent outputs fed as context in one prompt
- Asks for KPIs, 5 dimension scores, 4 risks, 4 opportunities, investor summary in one pass
- overall score = weighted average: market*0.25 + competition*0.20 + finance*0.25 + legal*0.15 + marketing*0.15

**Why:** Single call is faster and cheaper than 3 separate calls. json_object mode prevents markdown wrapper.

## SVG Gauge implementation
- viewBox="0 0 100 58", radius=38, cx=50, cy=50
- Path: `M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}` (semicircle from left to right through top)
- arcLength = Math.PI * 38 ≈ 119.38
- strokeDasharray = arcLength, strokeDashoffset = arcLength * (1 - value/100)
- value=0 → dashoffset=arcLength (nothing shown); value=100 → dashoffset=0 (full arc)

**Why:** No charting library needed; pure SVG is lightweight and fully controllable for cyber theme.

## Level thresholds
- EXCELLENT: ≥ 85
- GOOD: ≥ 70
- FAIR: ≥ 50
- POOR: < 50
